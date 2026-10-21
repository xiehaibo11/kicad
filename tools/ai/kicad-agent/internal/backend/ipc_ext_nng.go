// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

//go:build nng

package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/emptypb"

	kicadproto "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadproto"
	kschematic "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadproto/schematic"
)

// extIPCSpec maps a typed action onto one KiCad API request whose remaining
// fields are taken verbatim from the payload as protobuf JSON.  This covers
// every handler KiCad registers without hand-writing a decoder per message.
type extIPCSpec struct {
	newReq  func() proto.Message
	newResp func() proto.Message
	// docField names the DocumentSpecifier field ("board", "document", or
	// "job_settings.document").  Empty when the request has no document.
	docField string
	// kind is the document type used to auto-resolve an omitted document:
	// "pcb", "schematic", or "any" (taken from the payload, default pcb).
	kind string
	// requireDocument refuses to auto-resolve: destructive requests must name
	// the document explicitly.
	requireDocument bool
	// aliases maps convenience payload keys to request field names.
	aliases map[string]string
	// confirm requires {"confirm": true} in the payload.
	confirm bool
}

func empty() proto.Message { return &emptypb.Empty{} }

var extIPCActions = map[string]extIPCSpec{
	// --- common / system -------------------------------------------------
	"system.api.version": {newReq: func() proto.Message { return &kicadproto.GetVersion{} },
		newResp: func() proto.Message { return &kicadproto.GetVersionResponse{} }},
	"system.binary_path": {newReq: func() proto.Message { return &kicadproto.GetKiCadBinaryPath{} },
		newResp: func() proto.Message { return &kicadproto.PathResponse{} },
		aliases: map[string]string{"name": "binary_name", "binary": "binary_name"}},
	"system.paths": {newReq: func() proto.Message { return &kicadproto.GetPaths{} },
		newResp: func() proto.Message { return &kicadproto.GetPathsResponse{} }},
	"system.ping": {newReq: func() proto.Message { return &kicadproto.Ping{} }, newResp: empty},
	"system.plugin_settings_path": {newReq: func() proto.Message { return &kicadproto.GetPluginSettingsPath{} },
		newResp: func() proto.Message { return &kicadproto.StringResponse{} }},
	"project.netclasses.get": {newReq: func() proto.Message { return &kicadproto.GetNetClasses{} },
		newResp: func() proto.Message { return &kicadproto.NetClassesResponse{} }},
	"project.netclasses.set": {newReq: func() proto.Message { return &kicadproto.SetNetClasses{} },
		newResp: empty, aliases: map[string]string{"netClasses": "net_classes", "classes": "net_classes", "mergeMode": "merge_mode"}},
	"document.text.extents": {newReq: func() proto.Message { return &kicadproto.GetTextExtents{} },
		newResp: func() proto.Message { return &kicadproto.Box2{} }},
	"document.text.shapes": {newReq: func() proto.Message { return &kicadproto.GetTextAsShapes{} },
		newResp: func() proto.Message { return &kicadproto.GetTextAsShapesResponse{} }},
	"project.textvars.get": {newReq: func() proto.Message { return &kicadproto.GetTextVariables{} },
		newResp: func() proto.Message { return &kicadproto.TextVariables{} }, docField: "document", kind: "any"},
	"project.textvars.set": {newReq: func() proto.Message { return &kicadproto.SetTextVariables{} },
		newResp: empty, docField: "document", kind: "any", aliases: map[string]string{"mergeMode": "merge_mode"}},
	"document.close": {newReq: func() proto.Message { return &kicadproto.CloseDocument{} },
		newResp: empty, docField: "document", kind: "any", requireDocument: true},
	"document.close_all": {newReq: func() proto.Message { return &kicadproto.CloseAllDocuments{} },
		newResp: empty, confirm: true},
	"document.modified": {newReq: func() proto.Message { return &kicadproto.GetDocumentModifiedState{} },
		newResp: func() proto.Message { return &kicadproto.GetDocumentModifiedStateResponse{} }, docField: "document", kind: "any"},
	"document.save_copy": {newReq: func() proto.Message { return &kicadproto.SaveCopyOfDocument{} },
		newResp: empty, docField: "document", kind: "any", aliases: map[string]string{"output": "path"}},
	"editor.selection.export": {newReq: func() proto.Message { return &kicadproto.SaveSelectionToString{} },
		newResp: func() proto.Message { return &kicadproto.SavedSelectionResponse{} }},

	// --- schematic jobs and queries ----------------------------------------
	"schematic.jobs.svg": {newReq: func() proto.Message { return &kschematic.RunSchematicJobExportSvg{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "schematic"},
	"schematic.jobs.dxf": {newReq: func() proto.Message { return &kschematic.RunSchematicJobExportDxf{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "schematic"},
	"schematic.jobs.pdf": {newReq: func() proto.Message { return &kschematic.RunSchematicJobExportPdf{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "schematic"},
	"schematic.jobs.ps": {newReq: func() proto.Message { return &kschematic.RunSchematicJobExportPs{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "schematic"},
	"schematic.jobs.netlist": {newReq: func() proto.Message { return &kschematic.RunSchematicJobExportNetlist{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "schematic"},
	"schematic.jobs.bom": {newReq: func() proto.Message { return &kschematic.RunSchematicJobExportBOM{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "schematic",
		aliases: map[string]string{"excludeDnp": "exclude_dnp", "groupSymbols": "group_symbols"}},
	"schematic.hierarchy.get": {newReq: func() proto.Message { return &kschematic.GetSchematicHierarchy{} },
		newResp: func() proto.Message { return &kschematic.SchematicHierarchyResponse{} }, docField: "document", kind: "schematic"},

	// --- cross-probing ----------------------------------------------------------
	"editor.crossprobe.announce": {newReq: func() proto.Message { return &kicadproto.CrossProbeAnnounce{} },
		newResp: func() proto.Message { return &kicadproto.CrossProbeAnnounceResponse{} }},
	"editor.selection.sync": {newReq: func() proto.Message { return &kicadproto.SyncSelection{} },
		newResp: func() proto.Message { return &kicadproto.SyncSelectionResponse{} }},
	"editor.nets.highlight": {newReq: func() proto.Message { return &kicadproto.HighlightNets{} },
		newResp: func() proto.Message { return &kicadproto.HighlightNetsResponse{} },
		aliases: map[string]string{"nets": "net_name", "netNames": "net_name"}},

	// --- design variants (served by the schematic editor) -------------------
	"schematic.variants.add": {newReq: func() proto.Message { return &kicadproto.AddVariant{} },
		newResp: empty, docField: "document", kind: "schematic"},
	"schematic.variants.delete": {newReq: func() proto.Message { return &kicadproto.DeleteVariant{} },
		newResp: empty, docField: "document", kind: "schematic"},
	"schematic.variants.rename": {newReq: func() proto.Message { return &kicadproto.RenameVariant{} },
		newResp: empty, docField: "document", kind: "schematic",
		aliases: map[string]string{"from": "old_name", "to": "new_name"}},
	"schematic.variants.copy": {newReq: func() proto.Message { return &kicadproto.CopyVariant{} },
		newResp: empty, docField: "document", kind: "schematic",
		aliases: map[string]string{"from": "old_name", "to": "new_name"}},
	"schematic.variants.describe": {newReq: func() proto.Message { return &kicadproto.SetVariantDescription{} },
		newResp: empty, docField: "document", kind: "schematic"},
	"schematic.variants.current.set": {newReq: func() proto.Message { return &kicadproto.SetCurrentVariant{} },
		newResp: empty, docField: "document", kind: "schematic"},
	"schematic.variants.current.get": {newReq: func() proto.Message { return &kicadproto.GetCurrentVariant{} },
		newResp: func() proto.Message { return &kicadproto.CurrentVariantResponse{} }, docField: "document", kind: "schematic"},

	// --- board editor -----------------------------------------------------------
	"board.padstack.presence": {newReq: func() proto.Message { return &kicadproto.CheckPadstackPresenceOnLayers{} },
		newResp: func() proto.Message { return &kicadproto.PadstackPresenceResponse{} }, docField: "board", kind: "pcb",
		aliases: map[string]string{"ids": "items"}},
	"board.move.interactive": {newReq: func() proto.Message { return &kicadproto.InteractiveMoveItems{} },
		newResp: empty, docField: "board", kind: "pcb", aliases: map[string]string{"ids": "items"}},
	"board.items.from_string": {newReq: func() proto.Message { return &kicadproto.ParseAndCreateItemsFromString{} },
		newResp: func() proto.Message { return &kicadproto.CreateItemsResponse{} }, docField: "document", kind: "pcb",
		aliases: map[string]string{"sexpr": "contents", "text": "contents"}},
	"board.layers.visible.get": {newReq: func() proto.Message { return &kicadproto.GetVisibleLayers{} },
		newResp: func() proto.Message { return &kicadproto.BoardLayers{} }, docField: "board", kind: "pcb"},
	"board.layers.visible.set": {newReq: func() proto.Message { return &kicadproto.SetVisibleLayers{} },
		newResp: empty, docField: "board", kind: "pcb"},
	"board.layers.active.get": {newReq: func() proto.Message { return &kicadproto.GetActiveLayer{} },
		newResp: func() proto.Message { return &kicadproto.BoardLayerResponse{} }, docField: "board", kind: "pcb"},
	"board.layers.active.set": {newReq: func() proto.Message { return &kicadproto.SetActiveLayer{} },
		newResp: empty, docField: "board", kind: "pcb"},
	"editor.library.open": {newReq: func() proto.Message { return &kicadproto.OpenLibraryItem{} },
		newResp: empty},
	"board.embedded.add": {newReq: func() proto.Message { return &kicadproto.AddEmbeddedFiles{} },
		newResp: empty, docField: "board", kind: "pcb"},
	"board.embedded.set": {newReq: func() proto.Message { return &kicadproto.SetEmbeddedFiles{} },
		newResp: empty, docField: "board", kind: "pcb"},
	"board.appearance.get": {newReq: func() proto.Message { return &kicadproto.GetBoardEditorAppearanceSettings{} },
		newResp: func() proto.Message { return &kicadproto.BoardEditorAppearanceSettings{} }},
	"board.appearance.set": {newReq: func() proto.Message { return &kicadproto.SetBoardEditorAppearanceSettings{} },
		newResp: empty},
	"board.plotsettings.get": {newReq: func() proto.Message { return &kicadproto.GetBoardPlotSettings{} },
		newResp: func() proto.Message { return &kicadproto.BoardPlotSettingsResponse{} }, docField: "board", kind: "pcb"},
	"board.plotsettings.set": {newReq: func() proto.Message { return &kicadproto.SetBoardPlotSettings{} },
		newResp: empty, docField: "board", kind: "pcb", aliases: map[string]string{"plotSettings": "plot_settings", "settings": "plot_settings"}},
	"board.drc.marker.add": {newReq: func() proto.Message { return &kicadproto.InjectDrcError{} },
		newResp: func() proto.Message { return &kicadproto.InjectDrcErrorResponse{} }, docField: "board", kind: "pcb",
		aliases: map[string]string{"ids": "items"}},

	// --- board jobs (API job engine; output written by KiCad itself) ---------
	"board.jobs.3d": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExport3D{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.render": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportRender{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.dxf": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportDxf{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.pdf": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportPdf{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.ps": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportPs{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.gerbers": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportGerbers{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.drill": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportDrill{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.position": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportPosition{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.gencad": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportGencad{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.ipc2581": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportIpc2581{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.ipcd356": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportIpcD356{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.odb": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportODB{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
	"board.jobs.stats": {newReq: func() proto.Message { return &kicadproto.RunBoardJobExportStats{} },
		newResp: runJobResp, docField: "job_settings.document", kind: "pcb"},
}

func runJobResp() proto.Message { return &kicadproto.RunJobResponse{} }

// ExtendedIPCActions lists the actions served by the generic request mapper.
func ExtendedIPCActions() []string {
	out := make([]string, 0, len(extIPCActions))
	for name := range extIPCActions {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// extReserved payload keys are convenience inputs, never request fields.
var extReserved = map[string]bool{
	"document": true, "output": true, "timeoutMs": true, "request": true,
	"dryRun": true, "confirm": true, "type": true,
}

// callExtended serves an action from extIPCActions.  handled is false when the
// action is not in the table.
func (c *IPCClient) callExtended(ctx context.Context, action string, p map[string]any,
	start time.Time) (*Result, bool, error) {
	spec, ok := extIPCActions[action]
	if !ok {
		return nil, false, nil
	}

	if spec.confirm {
		if v, _ := p["confirm"].(bool); !v {
			return nil, true, &Error{Code: "CONFIRMATION_REQUIRED",
				Message: action + " is destructive; pass \"confirm\": true to proceed"}
		}
	}

	req, err := buildExtRequest(spec, p)
	if err != nil {
		return nil, true, err
	}

	if spec.docField != "" {
		if err := c.applyExtDocument(ctx, req, spec, p); err != nil {
			return nil, true, err
		}
	}

	resp := spec.newResp()
	if err := c.Call(ctx, req, resp); err != nil {
		return nil, true, err
	}

	data, err := toAny(resp)
	if err != nil {
		return nil, true, err
	}

	res := &Result{Action: action, OK: true, Data: data,
		ElapsedMs: time.Since(start).Milliseconds()}

	if statusErr := responseStatusError(resp); statusErr != nil {
		res.OK = false
		res.Error = statusErr
	}

	// ParseAndCreateItemsFromString is registered by this KiCad build but its
	// handler is a stub that creates nothing; never report that as success.
	if created, ok := resp.(*kicadproto.CreateItemsResponse); ok && action == "board.items.from_string" &&
		len(created.GetCreatedItems()) == 0 {
		res.OK = false
		res.Error = &Error{Code: "KICAD_HANDLER_STUB",
			Message: "KiCad's ParseAndCreateItemsFromString handler created no items (not implemented in this build)",
			Detail:  "use board.items.create with proto JSON, or board.footprint.place for library footprints"}
	}

	if job, ok := resp.(*kicadproto.RunJobResponse); ok {
		res.Artifacts = append(res.Artifacts, job.GetOutputPath()...)
		switch job.GetStatus() {
		case kicadproto.JobStatus_JS_SUCCESS, kicadproto.JobStatus_JS_WARNING:
		case kicadproto.JobStatus_JS_TIMEOUT:
			res.OK = false
			res.Error = &Error{Code: "TIMEOUT", Message: job.GetMessage()}
		case kicadproto.JobStatus_JS_CANCELLED:
			res.OK = false
			res.Error = &Error{Code: "CANCELLED", Message: job.GetMessage()}
		default:
			res.OK = false
			res.Error = &Error{Code: "JOB_FAILED",
				Message: fmt.Sprintf("%s: %s", job.GetStatus().String(), job.GetMessage())}
		}
	}

	return res, true, nil
}

// buildExtRequest fills the request from payload["request"] plus any top-level
// payload key that names a request field (JSON or proto name, or an alias).
// Unknown keys are rejected with the list of valid fields.
func buildExtRequest(spec extIPCSpec, p map[string]any) (proto.Message, error) {
	msg := spec.newReq()
	md := msg.ProtoReflect().Descriptor()
	body := map[string]any{}

	if raw, ok := p["request"].(map[string]any); ok {
		for k, v := range raw {
			body[k] = v
		}
	}

	var unknown []string
	plot := md.Fields().ByName("plot_settings")

	for key, value := range p {
		name := key
		if alias, ok := spec.aliases[key]; ok {
			name = alias
		}
		if key == "document" {
			continue // resolved by applyExtDocument (path or specifier object)
		}
		if extReserved[key] && name == key && fieldByKey(md, key) == nil {
			continue
		}
		if key == "board" && spec.docField == "board" {
			if _, isPath := value.(string); isPath {
				continue // document alias, resolved by applyExtDocument
			}
		}
		if fd := fieldByKey(md, name); fd != nil {
			body[string(fd.Name())] = value
			continue
		}
		// Job convenience: plot settings fields (layers, theme, ...) may be
		// given at the top level.
		if plot != nil && plot.Message() != nil {
			if fd := fieldByKey(plot.Message(), name); fd != nil {
				ps, _ := body["plot_settings"].(map[string]any)
				if ps == nil {
					ps = map[string]any{}
					body["plot_settings"] = ps
				}
				ps[string(fd.Name())] = value
				continue
			}
		}
		unknown = append(unknown, key)
	}

	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, &Error{Code: "BAD_INPUT",
			Message: "unknown payload field(s): " + strings.Join(unknown, ", "),
			Detail:  "valid request fields: " + strings.Join(fieldNames(md), ", ")}
	}

	normalizeExtJSON(md, body)

	raw, err := json.Marshal(body)
	if err != nil {
		return nil, &Error{Code: "BAD_INPUT", Message: err.Error()}
	}
	if err := (protojson.UnmarshalOptions{}).Unmarshal(raw, msg); err != nil {
		return nil, &Error{Code: "BAD_INPUT", Message: "payload does not match " +
			string(md.FullName()), Detail: err.Error()}
	}

	if job := md.Fields().ByName("job_settings"); job != nil {
		settings := msg.ProtoReflect().Mutable(job).Message()
		jd := settings.Descriptor()
		if out := argString(p, "output"); out != "" {
			if fd := jd.Fields().ByName("output_path"); fd != nil && !settings.Has(fd) {
				settings.Set(fd, protoreflect.ValueOfString(out))
			}
		}
		if t := argInt(p, "timeoutMs"); t > 0 || argBool(p, "dryRun") {
			if fd := jd.Fields().ByName("options"); fd != nil {
				opts := settings.Mutable(fd).Message()
				if t > 0 {
					opts.Set(opts.Descriptor().Fields().ByName("timeout_ms"),
						protoreflect.ValueOfUint32(uint32(t)))
				}
				if argBool(p, "dryRun") {
					opts.Set(opts.Descriptor().Fields().ByName("dry_run"), protoreflect.ValueOfBool(true))
				}
			}
		}
	}

	return msg, nil
}

func fieldByKey(md protoreflect.MessageDescriptor, key string) protoreflect.FieldDescriptor {
	fields := md.Fields()
	if fd := fields.ByName(protoreflect.Name(key)); fd != nil {
		return fd
	}
	if fd := fields.ByJSONName(key); fd != nil {
		return fd
	}
	snake := toSnake(key)
	if fd := fields.ByName(protoreflect.Name(snake)); fd != nil {
		return fd
	}
	return nil
}

func fieldNames(md protoreflect.MessageDescriptor) []string {
	var out []string
	fields := md.Fields()
	for i := 0; i < fields.Len(); i++ {
		out = append(out, string(fields.Get(i).Name()))
	}
	return out
}

func toSnake(s string) string {
	var b strings.Builder
	for i, r := range s {
		if r >= 'A' && r <= 'Z' {
			if i > 0 {
				b.WriteByte('_')
			}
			b.WriteRune(r + ('a' - 'A'))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// normalizeExtJSON rewrites human inputs into protobuf JSON in place:
// "F.Cu" -> "BL_F_Cu" for BoardLayer enums and "uuid" -> {"value": "uuid"} for
// KIID messages, recursively through nested messages and lists.
func normalizeExtJSON(md protoreflect.MessageDescriptor, body map[string]any) {
	for key, value := range body {
		fd := fieldByKey(md, key)
		if fd == nil {
			continue
		}
		body[key] = normalizeExtValue(fd, value)
	}
}

func normalizeExtValue(fd protoreflect.FieldDescriptor, value any) any {
	if list, ok := value.([]any); ok && fd.IsList() {
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = normalizeExtScalar(fd, item)
		}
		return out
	}
	if list, ok := value.([]string); ok && fd.IsList() {
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = normalizeExtScalar(fd, item)
		}
		return out
	}
	if s, ok := value.(string); ok && fd.IsList() && fd.Kind() == protoreflect.EnumKind {
		// "F.Cu,B.Cu" -> ["BL_F_Cu", "BL_B_Cu"]
		var out []any
		for _, part := range strings.Split(s, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, normalizeExtScalar(fd, part))
			}
		}
		return out
	}
	return normalizeExtScalar(fd, value)
}

func normalizeExtScalar(fd protoreflect.FieldDescriptor, value any) any {
	switch fd.Kind() {
	case protoreflect.EnumKind:
		if s, ok := value.(string); ok && fd.Enum().FullName() == "kiapi.board.types.BoardLayer" {
			if layer, ok := boardLayer(s); ok {
				return layer.String()
			}
		}
	case protoreflect.MessageKind:
		if fd.Message().FullName() == "kiapi.common.types.KIID" {
			if s, ok := value.(string); ok {
				return map[string]any{"value": s}
			}
		}
		if m, ok := value.(map[string]any); ok {
			normalizeExtJSON(fd.Message(), m)
			return m
		}
	}
	return value
}

// applyExtDocument sets the DocumentSpecifier field.  An explicit
// payload["document"] (path or specifier object) wins; otherwise the single
// open document of the requested kind is used.
func (c *IPCClient) applyExtDocument(ctx context.Context, req proto.Message, spec extIPCSpec,
	p map[string]any) error {
	target := req.ProtoReflect()
	parts := strings.Split(spec.docField, ".")
	for _, part := range parts[:len(parts)-1] {
		fd := target.Descriptor().Fields().ByName(protoreflect.Name(part))
		if fd == nil {
			return &Error{Code: "INTERNAL", Message: "bad document field " + spec.docField}
		}
		target = target.Mutable(fd).Message()
	}
	fd := target.Descriptor().Fields().ByName(protoreflect.Name(parts[len(parts)-1]))
	if fd == nil {
		return &Error{Code: "INTERNAL", Message: "bad document field " + spec.docField}
	}
	if target.Has(fd) {
		return nil // supplied verbatim through payload["request"]
	}

	doc, err := c.resolveDocument(ctx, p, spec)
	if err != nil {
		return err
	}
	target.Set(fd, protoreflect.ValueOfMessage(doc.ProtoReflect()))
	return nil
}

func (c *IPCClient) resolveDocument(ctx context.Context, p map[string]any,
	spec extIPCSpec) (*kicadproto.DocumentSpecifier, error) {
	if raw, ok := p["document"]; ok && raw != nil {
		return documentSpecifier(p)
	}
	if board, ok := p["board"].(string); ok && board != "" {
		return documentSpecifier(map[string]any{"document": board})
	}
	if spec.requireDocument {
		return nil, &Error{Code: "BAD_INPUT",
			Message: "document is required for this action (it is never auto-selected)"}
	}

	kind := spec.kind
	if kind == "any" {
		kind = strings.ToLower(argString(p, "type"))
		if kind == "" {
			kind = "pcb"
		}
	}
	return c.openDocument(ctx, kind)
}

// openDocument returns the single open document of a kind, as KiCad reports it.
func (c *IPCClient) openDocument(ctx context.Context, kind string) (*kicadproto.DocumentSpecifier, error) {
	docType := kicadproto.DocumentType_DOCTYPE_PCB
	switch kind {
	case "schematic", "sch":
		docType = kicadproto.DocumentType_DOCTYPE_SCHEMATIC
	case "pcb", "board", "":
	default:
		return nil, &Error{Code: "BAD_INPUT", Message: "type must be pcb or schematic"}
	}

	r := &kicadproto.GetOpenDocumentsResponse{}
	if err := c.Call(ctx, &kicadproto.GetOpenDocuments{Type: docType}, r); err != nil {
		return nil, err
	}

	docs := r.GetDocuments()
	switch len(docs) {
	case 0:
		return nil, &Error{Code: "NO_OPEN_DOCUMENT",
			Message: fmt.Sprintf("no open %s document; pass document or open one in KiCad", kind)}
	case 1:
		return docs[0], nil
	}

	var names []string
	for _, d := range docs {
		if f := d.GetBoardFilename(); f != "" {
			names = append(names, f)
		} else if pj := d.GetProject(); pj != nil {
			names = append(names, filepath.Join(pj.GetPath(), pj.GetName()))
		}
	}
	return nil, &Error{Code: "AMBIGUOUS_DOCUMENT",
		Message: "several documents are open; pass document",
		Detail:  strings.Join(names, ", ")}
}
