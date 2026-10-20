// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

//go:build nng

package backend

/*
#include <stdlib.h>
#include <string.h>
#include <nng/nng.h>
#include <nng/protocol/reqrep0/req.h>

static int kicad_req(const char *url, const void *data, size_t len, int timeout_ms,
                     void **out, size_t *outlen, char **errmsg)
{
    nng_socket sock;
    nng_msg   *msg = NULL;
    nng_msg   *rep = NULL;
    int        rv;

    *out = NULL;
    *outlen = 0;
    *errmsg = NULL;

    rv = nng_req0_open(&sock);
    if (rv != 0) {
        *errmsg = strdup(nng_strerror(rv));
        return rv;
    }

    nng_socket_set_ms(sock, NNG_OPT_RECVTIMEO, (nng_duration) timeout_ms);
    nng_socket_set_ms(sock, NNG_OPT_SENDTIMEO, (nng_duration) timeout_ms);

    rv = nng_dial(sock, url, NULL, 0);
    if (rv != 0) {
        *errmsg = strdup(nng_strerror(rv));
        nng_close(sock);
        return rv;
    }

    rv = nng_msg_alloc(&msg, 0);
    if (rv != 0) {
        *errmsg = strdup(nng_strerror(rv));
        nng_close(sock);
        return rv;
    }

    rv = nng_msg_append(msg, data, len);
    if (rv != 0) {
        *errmsg = strdup(nng_strerror(rv));
        nng_msg_free(msg);
        nng_close(sock);
        return rv;
    }

    rv = nng_sendmsg(sock, msg, 0);
    if (rv != 0) {
        *errmsg = strdup(nng_strerror(rv));
        nng_msg_free(msg); // sendmsg owns the message only on success
        nng_close(sock);
        return rv;
    }

    rv = nng_recvmsg(sock, &rep, 0);
    if (rv != 0) {
        *errmsg = strdup(nng_strerror(rv));
        nng_close(sock);
        return rv;
    }

    *outlen = nng_msg_len(rep);
    *out = malloc(*outlen ? *outlen : 1);
    if (*outlen)
        memcpy(*out, nng_msg_body(rep), *outlen);

    nng_msg_free(rep);
    nng_close(sock);
    return 0;
}

static void kicad_free(void *p) { free(p); }
*/
import "C"

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
	"google.golang.org/protobuf/types/known/emptypb"

	kicadproto "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadproto"
	kschematic "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadproto/schematic"
)

// IPCClient speaks the KiCad protobuf API over an NNG req/rep IPC socket.
type IPCClient struct {
	SocketPath string
	Timeout    time.Duration
	ClientName string
}

func NewIPCClient(socket string) *IPCClient {
	if socket == "" {
		socket = DefaultSocketPath()
	}
	return &IPCClient{SocketPath: socket, Timeout: 30 * time.Second, ClientName: "kicad-agent"}
}

func DefaultSocketPath() string { return filepath.Join(os.TempDir(), "kicad", "api.sock") }

func (c *IPCClient) Close() error { return nil }

// Call sends a protobuf request and unmarshals the response.
func (c *IPCClient) Call(ctx context.Context, req proto.Message, resp proto.Message) error {
	inner, err := anypb.New(req)
	if err != nil {
		return err
	}

	env := &kicadproto.ApiRequest{
		Header:  &kicadproto.ApiRequestHeader{ClientName: c.ClientName},
		Message: inner,
	}

	data, err := proto.Marshal(env)
	if err != nil {
		return err
	}

	raw, err := c.rawCall(ctx, data)
	if err != nil {
		return err
	}

	var rep kicadproto.ApiResponse
	if err := proto.Unmarshal(raw, &rep); err != nil {
		return &Error{Code: "IPC_BAD_RESPONSE", Message: "failed to decode API response",
			Detail: err.Error()}
	}

	st := rep.GetStatus()
	if st.GetStatus() != kicadproto.ApiStatusCode_AS_OK {
		return &Error{
			Code:    statusCodeName(st.GetStatus()),
			Message: st.GetErrorMessage(),
		}
	}

	if resp == nil {
		return nil
	}

	return rep.GetMessage().UnmarshalTo(resp)
}

func (c *IPCClient) rawCall(ctx context.Context, data []byte) ([]byte, error) {
	if ctx.Err() != nil {
		return nil, ctxError(ctx.Err())
	}

	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if dl, ok := ctx.Deadline(); ok {
		remaining := time.Until(dl)
		if remaining <= 0 {
			return nil, &Error{Code: "TIMEOUT", Message: "deadline expired before the IPC request"}
		}
		if remaining < timeout {
			timeout = remaining
		}
	}

	timeoutMs := timeout.Milliseconds()
	if timeoutMs < 1 {
		timeoutMs = 1
	}
	if timeoutMs > math.MaxInt32 {
		timeoutMs = math.MaxInt32
	}

	url := c.SocketPath
	if !strings.Contains(url, "://") {
		url = "ipc://" + url
	}

	curl := C.CString(url)
	defer C.free(unsafe.Pointer(curl))

	cdata := C.CBytes(data)
	defer C.free(cdata)

	var out unsafe.Pointer
	var outLen C.size_t
	var errMsg *C.char

	rv := C.kicad_req(curl, cdata, C.size_t(len(data)), C.int(timeoutMs),
		&out, &outLen, &errMsg)
	if rv != 0 {
		msg := "IPC request failed"
		if errMsg != nil {
			msg = C.GoString(errMsg)
			C.free(unsafe.Pointer(errMsg))
		}

		code := "IPC_ERROR"
		switch rv {
		case C.NNG_ETIMEDOUT:
			code = "TIMEOUT"
		case C.NNG_ECONNREFUSED, C.NNG_ENOENT:
			code = "IPC_UNAVAILABLE"
		}

		return nil, &Error{Code: code, Message: msg,
			Detail: fmt.Sprintf("%s (nng error %d)", url, int(rv))}
	}
	defer C.kicad_free(out)

	if outLen > math.MaxInt32 {
		return nil, &Error{Code: "IPC_BAD_RESPONSE", Message: "IPC response is too large"}
	}
	if out == nil && outLen > 0 {
		return nil, &Error{Code: "IPC_BAD_RESPONSE", Message: "IPC returned an empty buffer"}
	}

	return C.GoBytes(out, C.int(outLen)), nil
}

func ctxError(err error) error {
	if err == context.DeadlineExceeded {
		return &Error{Code: "TIMEOUT", Message: err.Error()}
	}
	if err == context.Canceled {
		return &Error{Code: "CANCELLED", Message: err.Error()}
	}
	return &Error{Code: "CANCELLED", Message: err.Error()}
}

// CallAction maps a typed KiCad action to its protobuf request.
func (c *IPCClient) CallAction(ctx context.Context, action string, p map[string]any) (*Result, error) {
	start := time.Now()
	res := &Result{Action: action}

	var resp proto.Message
	var err error

	switch action {
	case "system.capabilities":
		r := &kicadproto.GetCapabilitiesResponse{}
		err = c.Call(ctx, &kicadproto.GetCapabilities{}, r)
		resp = r

	case "job.status":
		id := argString(p, "job_id")
		if id == "" {
			id = argString(p, "jobId")
		}
		if id == "" {
			return nil, &Error{Code: "BAD_INPUT", Message: "job_id is required"}
		}
		r := &kicadproto.JobStatusResponse{}
		err = c.Call(ctx, &kicadproto.GetJobStatus{JobId: id}, r)
		resp = r

	case "job.cancel":
		id := argString(p, "job_id")
		if id == "" {
			id = argString(p, "jobId")
		}
		if id == "" {
			return nil, &Error{Code: "BAD_INPUT", Message: "job_id is required"}
		}
		r := &kicadproto.CancelJobResponse{}
		err = c.Call(ctx, &kicadproto.CancelJob{JobId: id}, r)
		resp = r

	case "board.jobs.svg":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		output := argString(p, "output")
		if output == "" {
			return nil, &Error{Code: "BAD_INPUT", Message: "output is required"}
		}
		req := &kicadproto.RunBoardJobExportSvg{
			JobSettings: &kicadproto.RunJobSettings{
				Document:   doc,
				OutputPath: output,
			},
			PlotSettings: &kicadproto.BoardPlotSettings{},
		}
		for _, name := range argStrings(p, "layers") {
			layer, ok := boardLayer(name)
			if !ok {
				return nil, &Error{Code: "BAD_LAYER", Message: "unknown layer " + name}
			}
			req.PlotSettings.Layers = append(req.PlotSettings.Layers, layer)
		}
		if v := argInt(p, "timeoutMs"); v > 0 {
			req.JobSettings.Options = &kicadproto.JobOptions{TimeoutMs: uint32(v)}
		}
		r := &kicadproto.RunJobResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "document.list":
		docType := kicadproto.DocumentType_DOCTYPE_PCB
		switch strings.ToLower(argString(p, "type")) {
		case "schematic", "sch":
			docType = kicadproto.DocumentType_DOCTYPE_SCHEMATIC
		case "pcb", "board", "":
		default:
			return nil, &Error{Code: "BAD_INPUT", Message: "type must be pcb or schematic"}
		}
		r := &kicadproto.GetOpenDocumentsResponse{}
		err = c.Call(ctx, &kicadproto.GetOpenDocuments{Type: docType}, r)
		resp = r

	case "project.open":
		path := argString(p, "document")

		if path == "" {
			path = argString(p, "project")
		}
		if path == "" {
			return nil, &Error{Code: "BAD_INPUT",
				Message: "document or project path is required"}
		}

		info, statErr := os.Stat(path)

		if statErr == nil && info.IsDir() {
			entries, _ := os.ReadDir(path)

			for _, entry := range entries {
				if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".kicad_pcb") {
					path = filepath.Join(path, entry.Name())
					break
				}
			}

			if filepath.Ext(path) == "" {
				for _, entry := range entries {
					if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".kicad_sch") {
						path = filepath.Join(path, entry.Name())
						break
					}
				}
			}
		}

		abs, absErr := filepath.Abs(path)
		if absErr == nil {
			path = abs
		}

		docType := kicadproto.DocumentType_DOCTYPE_PCB

		switch strings.ToLower(filepath.Ext(path)) {
		case ".kicad_pcb":
			docType = kicadproto.DocumentType_DOCTYPE_PCB
		case ".kicad_sch":
			docType = kicadproto.DocumentType_DOCTYPE_SCHEMATIC
		case ".kicad_pro":
			docType = kicadproto.DocumentType_DOCTYPE_PROJECT
		default:
			return nil, &Error{Code: "BAD_INPUT",
				Message: "document must be a .kicad_pcb, .kicad_sch, or .kicad_pro file"}
		}

		r := &kicadproto.OpenDocumentResponse{}
		err = c.Call(ctx, &kicadproto.OpenDocument{Type: docType, Path: path}, r)
		resp = r

	case "project.info":
		docType := kicadproto.DocumentType_DOCTYPE_PCB

		switch strings.ToLower(argString(p, "type")) {
		case "schematic", "sch":
			docType = kicadproto.DocumentType_DOCTYPE_SCHEMATIC
		case "pcb", "board", "":
		default:
			return nil, &Error{Code: "BAD_INPUT", Message: "type must be pcb or schematic"}
		}

		r := &kicadproto.GetOpenDocumentsResponse{}
		err = c.Call(ctx, &kicadproto.GetOpenDocuments{Type: docType}, r)
		resp = r

	case "document.save":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		r := &emptypb.Empty{}
		err = c.Call(ctx, &kicadproto.SaveDocument{Document: doc}, r)
		resp = r

	case "document.revert":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		r := &emptypb.Empty{}
		err = c.Call(ctx, &kicadproto.RevertDocument{Document: doc}, r)
		resp = r

	case "board.connectivity.prove":
		req, e := proveRequest(p)
		if e != nil {
			return nil, e
		}
		r := &kicadproto.ConnectivityProof{}
		err = c.Call(ctx, req, r)
		resp = r

	case "board.layers.get":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		r := &kicadproto.BoardEnabledLayersResponse{}
		err = c.Call(ctx, &kicadproto.GetBoardEnabledLayers{Board: doc}, r)
		resp = r

	case "board.stackup.read":
		req, _, e := stackupRequest(action, p)
		if e != nil {
			return nil, e
		}
		r := &kicadproto.BoardStackupResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "board.stackup.write":
		req, _, e := stackupRequest(action, p)
		if e != nil {
			return nil, e
		}
		r := &kicadproto.BoardStackupResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "board.zones.refill":
		req, e := refillRequest(p)
		if e != nil {
			return nil, e
		}
		r := &emptypb.Empty{}
		err = c.Call(ctx, req, r)
		resp = r

	case "board.netlist.import":
		req, e := importNetlistRequest(p)
		if e != nil {
			return nil, e
		}
		r := &kicadproto.ImportNetlistResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "board.place.autoplace":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		req := &kicadproto.AutoPlaceFootprints{
			Board:         doc,
			PlaceOffboard: argBool(p, "placeOffboard"),
			DryRun:        argBool(p, "dryRun"),
		}
		for _, id := range argStrings(p, "footprints") {
			req.Footprints = append(req.Footprints, &kicadproto.KIID{Value: id})
		}
		r := &kicadproto.AutoPlaceFootprintsResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "board.plane.create":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		req := &kicadproto.CreatePlane{
			Board:    doc,
			Net:      argString(p, "net"),
			Name:     argString(p, "name"),
			Fill:     argBool(p, "fill"),
			Priority: uint32(argInt(p, "priority")),
		}
		for _, name := range argStrings(p, "layers") {
			layer, ok := boardLayer(name)
			if !ok {
				return nil, &Error{Code: "BAD_LAYER",
					Message: fmt.Sprintf("unknown board layer %q", name)}
			}
			req.Layers = append(req.Layers, layer)
		}
		outline, e := argVector2(p, "outline")
		if e != nil {
			return nil, e
		}
		for _, point := range outline {
			req.Outline = append(req.Outline, &kicadproto.Vector2{
				XNm: point.X, YNm: point.Y,
			})
		}
		if v := argInt(p, "clearanceNm"); v > 0 {
			req.Clearance = &kicadproto.Distance{ValueNm: int64(v)}
		}
		if v := argInt(p, "minThicknessNm"); v > 0 {
			req.MinThickness = &kicadproto.Distance{ValueNm: int64(v)}
		}
		r := &kicadproto.CreatePlaneResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "board.plane.verify":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		req := &kicadproto.VerifyPlane{
			Board: doc,
			Zone:  &kicadproto.KIID{Value: argString(p, "zone")},
		}
		r := &kicadproto.VerifyPlaneResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "schematic.netlist.get":
		req, e := schematicNetlistRequest(p)
		if e != nil {
			return nil, e
		}
		r := &kschematic.SchematicNetlistResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "schematic.create":
		req := &kicadproto.CreateDocument{
			Type: kicadproto.DocumentType_DOCTYPE_SCHEMATIC,
			Path: argString(p, "path"),
		}
		r := &kicadproto.OpenDocumentResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "library.search.symbols":
		req := &kschematic.SearchLibrarySymbolsRequest{
			Query:    argString(p, "query"),
			Library:  argString(p, "library"),
			MinPins:  uint32(argInt(p, "minPins")),
			MaxPins:  uint32(argInt(p, "maxPins")),
			Keywords: argStrings(p, "keywords"),
			Limit:    uint32(argInt(p, "limit")),
		}
		r := &kschematic.SearchLibrarySymbolsResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "library.get.symbol":
		id, e := libIdProto(p)
		if e != nil {
			return nil, e
		}
		r := &kschematic.GetLibrarySymbolResponse{}
		err = c.Call(ctx, &kschematic.GetLibrarySymbolRequest{Id: id}, r)
		resp = r

	case "schematic.place.symbol":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		id, e := libIdProto(p)
		if e != nil {
			return nil, e
		}
		pos, e := argPositionNm(p, "position")
		if e != nil {
			return nil, e
		}
		req := &kschematic.PlaceSymbolFromLibraryRequest{
			Schematic: doc,
			Id:        id,
			Position:  pos,
			Unit:      int32(argInt(p, "unit")),
			Reference: argString(p, "reference"),
			Value:     argString(p, "value"),
			Footprint: argString(p, "footprint"),
		}
		r := &kschematic.PlaceSymbolFromLibraryResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "schematic.annotate":
		doc, e := documentSpecifier(p)
		if e != nil {
			return nil, e
		}
		req := &kschematic.AnnotateSchematicRequest{
			Schematic:      doc,
			Reset_:         argBool(p, "reset"),
			Start:          int32(argInt(p, "start")),
			UseSheetNumber: argBool(p, "useSheetNumber"),
			SheetInterval:  int32(argInt(p, "sheetInterval")),
		}
		r := &kschematic.AnnotateSchematicResponse{}
		err = c.Call(ctx, req, r)
		resp = r

	case "board.items.get", "board.items.create", "board.items.update", "board.items.delete",
		"schematic.items.get", "schematic.items.create", "schematic.items.update",
		"schematic.items.delete":
		req, r, e := itemsRequest(action, p)
		if e != nil {
			return nil, e
		}
		err = c.Call(ctx, req, r)
		resp = r

	default:
		return nil, &Error{Code: "UNKNOWN_ACTION",
			Message: fmt.Sprintf("IPC backend does not implement %q", action)}
	}

	if err != nil {
		return nil, err
	}

	data, err := toAny(resp)
	if err != nil {
		return nil, err
	}

	res.Data = data
	res.ElapsedMs = time.Since(start).Milliseconds()

	// KiCad reports per-item failures inside an AS_OK envelope.  Surface them
	// instead of letting callers proceed as if every mutation succeeded.
	if statusErr := responseStatusError(resp); statusErr != nil {
		res.OK = false
		res.Error = statusErr
	} else {
		res.OK = true
	}

	return res, nil
}

// responseStatusError inspects nested status fields that the envelope does not
// reflect.
func responseStatusError(resp proto.Message) *Error {
	switch r := resp.(type) {
	case *kicadproto.GetItemsResponse:
		if r.GetStatus() != kicadproto.ItemRequestStatus_IRS_OK {
			return &Error{Code: "ITEM_REQUEST_FAILED", Message: r.GetStatus().String()}
		}

	case *kicadproto.CreateItemsResponse:
		if r.GetStatus() != kicadproto.ItemRequestStatus_IRS_OK {
			return &Error{Code: "ITEM_REQUEST_FAILED", Message: r.GetStatus().String()}
		}

		var failures []string

		for i, item := range r.GetCreatedItems() {
			code := item.GetStatus().GetCode()

			if code != kicadproto.ItemStatusCode_ISC_OK {
				failures = append(failures, fmt.Sprintf("item %d: %s %s", i,
					code.String(), item.GetStatus().GetErrorMessage()))
			}
		}

		if len(failures) > 0 {
			return &Error{Code: "ITEMS_NOT_CREATED", Message: strings.Join(failures, "; ")}
		}

	case *kicadproto.UpdateItemsResponse:
		if r.GetStatus() != kicadproto.ItemRequestStatus_IRS_OK {
			return &Error{Code: "ITEM_REQUEST_FAILED", Message: r.GetStatus().String()}
		}

		var failures []string

		for i, item := range r.GetUpdatedItems() {
			code := item.GetStatus().GetCode()

			if code != kicadproto.ItemStatusCode_ISC_OK {
				failures = append(failures, fmt.Sprintf("item %d: %s %s", i,
					code.String(), item.GetStatus().GetErrorMessage()))
			}
		}

		if len(failures) > 0 {
			return &Error{Code: "ITEMS_NOT_UPDATED", Message: strings.Join(failures, "; ")}
		}

	case *kicadproto.DeleteItemsResponse:
		if r.GetStatus() != kicadproto.ItemRequestStatus_IRS_OK {
			return &Error{Code: "ITEM_REQUEST_FAILED", Message: r.GetStatus().String()}
		}

		var failures []string

		for i, item := range r.GetDeletedItems() {
			if item.GetStatus() != kicadproto.ItemDeletionStatus_IDS_OK {
				failures = append(failures, fmt.Sprintf("item %d: %s", i, item.GetStatus().String()))
			}
		}

		if len(failures) > 0 {
			return &Error{Code: "ITEMS_NOT_DELETED", Message: strings.Join(failures, "; ")}
		}

	case *kicadproto.ImportNetlistResponse:
		if r.GetErrorCount() > 0 {
			return &Error{Code: "NETLIST_IMPORT_ERRORS",
				Message: fmt.Sprintf("%d error(s): %s", r.GetErrorCount(), r.GetReport())}
		}

	case *kicadproto.ConnectivityProof:
		if !r.GetOk() {
			nets := r.GetUnconnectedNets()

			return &Error{Code: "CONNECTIVITY_UNPROVEN",
				Message: fmt.Sprintf("connectivity proof failed (%d unconnected net(s): %s)",
					len(nets), strings.Join(nets, ", "))}
		}

	case *kicadproto.VerifyPlaneResponse:
		pads := r.GetUnconnectedPads()
		vias := r.GetUnconnectedVias()

		if len(pads) > 0 || len(vias) > 0 {
			return &Error{Code: "PLANE_UNCONNECTED",
				Message: fmt.Sprintf("plane has %d unconnected pad(s) and %d unconnected via(s)",
					len(pads), len(vias))}
		}
	}

	return nil
}

func toAny(msg proto.Message) (any, error) {
	if msg == nil {
		return nil, nil
	}
	raw, err := (protojson.MarshalOptions{EmitUnpopulated: true}).Marshal(msg)
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func statusCodeName(code kicadproto.ApiStatusCode) string {
	if name, ok := kicadproto.ApiStatusCode_name[int32(code)]; ok {
		return strings.TrimPrefix(name, "AS_")
	}
	return "UNKNOWN"
}

func documentSpecifier(p map[string]any) (*kicadproto.DocumentSpecifier, error) {
	var docType, path, projectName, projectPath string

	switch v := p["document"].(type) {
	case string:
		path = v
	case map[string]any:
		docType = argString(v, "type")
		path = argString(v, "path")
		if path == "" {
			path = argString(v, "boardFilename")
		}
		projectName = argString(v, "projectName")
		projectPath = argString(v, "projectPath")

		// Responses emit DocumentSpecifier.ProjectSpecifier{name,path}.
		if pj, ok := v["project"].(map[string]any); ok {
			if projectName == "" {
				projectName = argString(pj, "name")
			}
			if projectPath == "" {
				projectPath = argString(pj, "path")
			}
		}
	}

	if path != "" && !filepath.IsAbs(path) {
		if abs, err := filepath.Abs(path); err == nil {
			path = abs
		}
	}

	switch strings.ToUpper(docType) {
	case "DOCTYPE_PCB":
		docType = "pcb"
	case "DOCTYPE_SCHEMATIC":
		docType = "schematic"
	}

	if docType == "" {
		switch strings.ToLower(filepath.Ext(path)) {
		case ".kicad_pcb":
			docType = "pcb"
		case ".kicad_sch":
			docType = "schematic"
		}
	}

	spec := &kicadproto.DocumentSpecifier{}

	switch strings.ToLower(docType) {
	case "pcb", "board":
		spec.Type = kicadproto.DocumentType_DOCTYPE_PCB
		if path != "" {
			spec.Identifier = &kicadproto.DocumentSpecifier_BoardFilename{
				BoardFilename: filepath.Base(path),
			}
		}
	case "schematic", "sch":
		spec.Type = kicadproto.DocumentType_DOCTYPE_SCHEMATIC
	default:
		return nil, &Error{Code: "BAD_DOCUMENT",
			Message: "document is required (path or {type,path})"}
	}

	if projectPath == "" && path != "" {
		projectPath = filepath.Dir(path)
	}
	if projectName == "" && projectPath != "" {
		// The API server derives the project path from the opened document
		// (same stem, .kicad_pro extension), so the project name is the
		// document stem -- not necessarily the containing directory or an
		// unrelated .kicad_pro file in that directory.
		if path != "" {
			base := filepath.Base(path)
			projectName = strings.TrimSuffix(base, filepath.Ext(base))
		} else {
			projectName = filepath.Base(projectPath)
		}
	}
	// PROJECT::GetProjectPath() always ends with a path separator (GetPathWithSep).
	// Schematic document validation compares the string exactly.
	if spec.Type == kicadproto.DocumentType_DOCTYPE_SCHEMATIC && projectPath != "" {
		sep := string(filepath.Separator)
		if !strings.HasSuffix(projectPath, sep) {
			projectPath += sep
		}
	}
	if projectPath != "" || projectName != "" {
		spec.Project = &kicadproto.ProjectSpecifier{Name: projectName, Path: projectPath}
	}

	return spec, nil
}

func proveRequest(p map[string]any) (*kicadproto.ProveConnectivity, error) {
	doc, err := documentSpecifier(p)
	if err != nil {
		return nil, err
	}
	req := &kicadproto.ProveConnectivity{Board: doc}
	for _, s := range argStrings(p, "anchors") {
		req.Anchors = append(req.Anchors, &kicadproto.KIID{Value: s})
	}
	req.Nets = argStrings(p, "nets")
	if v, ok := p["requireFilledZones"].(bool); ok {
		req.RequireFilledZones = &v
	}
	return req, nil
}

func stackupRequest(action string, p map[string]any) (proto.Message, proto.Message, error) {
	doc, err := documentSpecifier(p)
	if err != nil {
		return nil, nil, err
	}
	if action == "board.stackup.read" {
		return &kicadproto.GetBoardStackup{Board: doc}, &kicadproto.BoardStackupResponse{}, nil
	}
	raw, err := json.Marshal(p["stackup"])
	if err != nil {
		return nil, nil, &Error{Code: "BAD_INPUT", Message: "stackup is required"}
	}
	st := &kicadproto.BoardStackup{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(raw, st); err != nil {
		return nil, nil, &Error{Code: "BAD_STACKUP", Message: "invalid stackup JSON",
			Detail: err.Error()}
	}
	return &kicadproto.UpdateBoardStackup{Board: doc, Stackup: st},
		&kicadproto.BoardStackupResponse{}, nil
}

func refillRequest(p map[string]any) (*kicadproto.RefillZones, error) {
	doc, err := documentSpecifier(p)
	if err != nil {
		return nil, err
	}
	req := &kicadproto.RefillZones{Board: doc}
	for _, id := range argStrings(p, "zones") {
		req.Zones = append(req.Zones, &kicadproto.KIID{Value: id})
	}
	return req, nil
}

func importNetlistRequest(p map[string]any) (*kicadproto.ImportNetlist, error) {
	doc, err := documentSpecifier(p)
	if err != nil {
		return nil, err
	}
	netlist := argString(p, "netlistPath")
	if netlist == "" {
		netlist = argString(p, "netlist")
	}
	if netlist == "" {
		return nil, &Error{Code: "BAD_INPUT", Message: "netlistPath is required"}
	}
	return &kicadproto.ImportNetlist{
		Board:                 doc,
		NetlistPath:           netlist,
		DryRun:                argBool(p, "dryRun"),
		DeleteExtraFootprints: argBool(p, "deleteExtraFootprints"),
		UpdateFootprints:      argBool(p, "updateFootprints"),
		TransferGroups:        argBool(p, "transferGroups"),
		OverrideLocks:         argBool(p, "overrideLocks"),
	}, nil
}

func schematicNetlistRequest(p map[string]any) (*kschematic.GetSchematicNetlist, error) {
	doc, err := documentSpecifier(p)
	if err != nil {
		return nil, err
	}
	return &kschematic.GetSchematicNetlist{Document: doc}, nil
}

func itemsRequest(action string, p map[string]any) (proto.Message, proto.Message, error) {
	doc, err := documentSpecifier(p)
	if err != nil {
		return nil, nil, err
	}

	domain := "board"
	if strings.HasPrefix(action, "schematic.") {
		domain = "schematic"
	}

	header := &kicadproto.ItemHeader{Document: doc}

	if container := argString(p, "container"); container != "" {
		header.Container = &kicadproto.KIID{Value: container}
	} else if obj, ok := p["container"].(map[string]any); ok {
		if id := argString(obj, "id"); id != "" {
			header.Container = &kicadproto.KIID{Value: id}
		}
	}

	switch action {
	case "board.items.get", "schematic.items.get":
		req := &kicadproto.GetItems{Header: header}
		for _, name := range argStrings(p, "types") {
			t, ok := objectType(domain, name)
			if !ok {
				return nil, nil, &Error{Code: "BAD_ITEM_TYPE",
					Message: fmt.Sprintf("unknown %s item type %q", domain, name)}
			}
			req.Types = append(req.Types, t)
		}
		return req, &kicadproto.GetItemsResponse{}, nil

	case "board.items.create", "schematic.items.create":
		items, e := anyItems(p["items"], domain)
		if e != nil {
			return nil, nil, e
		}
		req := &kicadproto.CreateItems{Header: header, Items: items}
		return req, &kicadproto.CreateItemsResponse{}, nil

	case "board.items.update", "schematic.items.update":
		items, e := anyItems(p["items"], domain)
		if e != nil {
			return nil, nil, e
		}
		req := &kicadproto.UpdateItems{Header: header, Items: items}
		return req, &kicadproto.UpdateItemsResponse{}, nil

	case "board.items.delete", "schematic.items.delete":
		req := &kicadproto.DeleteItems{Header: header}
		for _, id := range argStrings(p, "ids") {
			req.ItemIds = append(req.ItemIds, &kicadproto.KIID{Value: id})
		}
		return req, &kicadproto.DeleteItemsResponse{}, nil
	}

	return nil, nil, &Error{Code: "UNKNOWN_ACTION", Message: action}
}

func anyItems(raw any, domain string) ([]*anypb.Any, error) {
	arr, ok := raw.([]any)
	if !ok {
		return nil, &Error{Code: "BAD_INPUT", Message: "items must be an array"}
	}

	out := make([]*anypb.Any, 0, len(arr))

	for i, entry := range arr {
		m, ok := entry.(map[string]any)
		if !ok {
			return nil, &Error{Code: "BAD_ITEM",
				Message: fmt.Sprintf("item %d must be an object", i)}
		}

		// Raw form: {"typeUrl": "...", "valueBase64": "..."}
		if typeURL := argString(m, "typeUrl"); typeURL != "" {
			encoded := argString(m, "valueBase64")
			if encoded == "" {
				return nil, &Error{Code: "BAD_ITEM",
					Message: fmt.Sprintf("item %d has an empty valueBase64", i)}
			}
			value, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil {
				return nil, &Error{Code: "BAD_ITEM",
					Message: fmt.Sprintf("item %d has invalid valueBase64", i)}
			}
			out = append(out, &anypb.Any{TypeUrl: typeURL, Value: value})
			continue
		}

		// Convenience form: {"type": "track", "json": {...}}
		typeName := strings.ToLower(argString(m, "type"))
		factory, ok := itemFactories(domain)[typeName]
		if !ok {
			return nil, &Error{Code: "UNKNOWN_ITEM_TYPE",
				Message: fmt.Sprintf("item %d has unknown %s type %q", i, domain, typeName),
				Detail:  "available: " + strings.Join(itemTypeNames(domain), ", ")}
		}

		msg := factory()
		if m["json"] == nil {
			return nil, &Error{Code: "BAD_ITEM",
				Message: fmt.Sprintf("item %d is missing the json object", i)}
		}

		payload, err := json.Marshal(m["json"])
		if err != nil {
			return nil, &Error{Code: "BAD_ITEM", Message: fmt.Sprintf("item %d json invalid", i)}
		}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(payload, msg); err != nil {
			return nil, &Error{Code: "BAD_ITEM",
				Message: fmt.Sprintf("item %d does not match %s", i, typeName),
				Detail:  err.Error()}
		}
		a, err := anypb.New(msg)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}

	return out, nil
}

var boardItemFactories = map[string]func() proto.Message{
	"track":             func() proto.Message { return &kicadproto.Track{} },
	"arc":               func() proto.Message { return &kicadproto.Arc{} },
	"via":               func() proto.Message { return &kicadproto.Via{} },
	"pad":               func() proto.Message { return &kicadproto.Pad{} },
	"zone":              func() proto.Message { return &kicadproto.Zone{} },
	"footprint":         func() proto.Message { return &kicadproto.FootprintInstance{} },
	"footprintinstance": func() proto.Message { return &kicadproto.FootprintInstance{} },
	"boardtext":         func() proto.Message { return &kicadproto.BoardText{} },
	"text":              func() proto.Message { return &kicadproto.BoardText{} },
	"boardtextbox":      func() proto.Message { return &kicadproto.BoardTextBox{} },
	"textbox":           func() proto.Message { return &kicadproto.BoardTextBox{} },
	"shape":             func() proto.Message { return &kicadproto.BoardGraphicShape{} },
}

var schematicItemFactories = map[string]func() proto.Message{
	"symbol":           func() proto.Message { return &kschematic.SchematicSymbolInstance{} },
	"line":             func() proto.Message { return &kschematic.SchematicLine{} },
	"wire":             func() proto.Message { return &kschematic.SchematicLine{} },
	"junction":         func() proto.Message { return &kschematic.Junction{} },
	"noconnect":        func() proto.Message { return &kschematic.NoConnectMarker{} },
	"label":            func() proto.Message { return &kschematic.LocalLabel{} },
	"globallabel":      func() proto.Message { return &kschematic.GlobalLabel{} },
	"hierlabel":        func() proto.Message { return &kschematic.HierarchicalLabel{} },
	"schematictext":    func() proto.Message { return &kschematic.SchematicText{} },
	"text":             func() proto.Message { return &kschematic.SchematicText{} },
	"schematictextbox": func() proto.Message { return &kschematic.SchematicTextBox{} },
	"textbox":          func() proto.Message { return &kschematic.SchematicTextBox{} },
	"shape":            func() proto.Message { return &kschematic.SchematicGraphicShape{} },
}

func itemFactories(domain string) map[string]func() proto.Message {
	if domain == "schematic" {
		return schematicItemFactories
	}
	return boardItemFactories
}

func itemTypeNames(domain string) []string {
	factories := itemFactories(domain)
	names := make([]string, 0, len(factories))

	for k := range factories {
		names = append(names, k)
	}

	sort.Strings(names)
	return names
}

func objectType(domain, name string) (kicadproto.KiCadObjectType, bool) {
	upper := strings.ToUpper(strings.TrimSpace(name))

	if v, ok := kicadproto.KiCadObjectType_value[upper]; ok {
		prefix := "KOT_PCB_"
		if domain == "schematic" {
			prefix = "KOT_SCH_"
		}
		if strings.HasPrefix(upper, prefix) {
			return kicadproto.KiCadObjectType(v), true
		}
	}

	aliases := map[string]string{
		"footprint":   "KOT_PCB_FOOTPRINT",
		"pad":         "KOT_PCB_PAD",
		"shape":       "KOT_PCB_SHAPE",
		"trace":       "KOT_PCB_TRACE",
		"track":       "KOT_PCB_TRACE",
		"via":         "KOT_PCB_VIA",
		"arc":         "KOT_PCB_ARC",
		"zone":        "KOT_PCB_ZONE",
		"text":        "KOT_PCB_TEXT",
		"textbox":     "KOT_PCB_TEXTBOX",
		"symbol":      "KOT_SCH_SYMBOL",
		"wire":        "KOT_SCH_LINE",
		"line":        "KOT_SCH_LINE",
		"label":       "KOT_SCH_LABEL",
		"globallabel": "KOT_SCH_GLOBAL_LABEL",
		"hierlabel":   "KOT_SCH_HIER_LABEL",
		"junction":    "KOT_SCH_JUNCTION",
		"noconnect":   "KOT_SCH_NO_CONNECT",
	}

	if full, ok := aliases[strings.ToLower(name)]; ok {
		prefix := "KOT_PCB_"
		if domain == "schematic" {
			prefix = "KOT_SCH_"
		}
		if strings.HasPrefix(full, prefix) {
			if v, ok := kicadproto.KiCadObjectType_value[full]; ok {
				return kicadproto.KiCadObjectType(v), true
			}
		}
	}

	return 0, false
}

type point2 struct {
	X int64
	Y int64
}

// argVector2 reads [{"xNm":..,"yNm":..}], [{"x":..,"y":..}], or [{"xMm":..,"yMm":..}].
func argVector2(p map[string]any, key string) ([]point2, error) {
	raw, present := p[key]
	if !present || raw == nil {
		return nil, nil
	}

	arr, ok := raw.([]any)
	if !ok {
		return nil, &Error{Code: "BAD_POINT", Message: key + " must be an array"}
	}

	out := make([]point2, 0, len(arr))

	for i, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			return nil, &Error{Code: "BAD_POINT",
				Message: fmt.Sprintf("%s[%d] must be an object", key, i)}
		}

		x, xok := numValue(m["xNm"])
		if !xok {
			x, xok = numValue(m["x"])
		}
		if !xok {
			if v, ok := floatValue(m["xMm"]); ok {
				x, xok = int64(v*1_000_000), true
			}
		}

		y, yok := numValue(m["yNm"])
		if !yok {
			y, yok = numValue(m["y"])
		}
		if !yok {
			if v, ok := floatValue(m["yMm"]); ok {
				y, yok = int64(v*1_000_000), true
			}
		}

		if !xok || !yok {
			return nil, &Error{Code: "BAD_POINT",
				Message: fmt.Sprintf("%s[%d] needs xNm/x/xMm and yNm/y/yMm", key, i)}
		}

		out = append(out, point2{X: x, Y: y})
	}

	return out, nil
}

func libIdProto(p map[string]any) (*kicadproto.LibraryIdentifier, error) {
	if raw := argString(p, "libId"); raw != "" {
		library, entry, ok := strings.Cut(raw, ":")
		if !ok || library == "" || entry == "" {
			return nil, &Error{Code: "BAD_LIB_ID",
				Message: "libId must be in 'Library:Symbol' form"}
		}
		return &kicadproto.LibraryIdentifier{LibraryNickname: library, EntryName: entry}, nil
	}

	library := argString(p, "library")
	entry := argString(p, "entry")

	if library == "" || entry == "" {
		return nil, &Error{Code: "BAD_LIB_ID",
			Message: "provide libId ('Library:Symbol') or library+entry"}
	}

	return &kicadproto.LibraryIdentifier{LibraryNickname: library, EntryName: entry}, nil
}

func numValue(v any) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case int64:
		return n, true
	case int:
		return int64(n), true
	case json.Number:
		i, err := n.Int64()
		return i, err == nil
	case string:
		i, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64)
		return i, err == nil
	}
	return 0, false
}

func floatValue(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int64:
		return float64(n), true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f, err == nil
	}
	return 0, false
}

// argPositionNm accepts {xNm,yNm}, {x,y} (nm), or {xMm,yMm}.
func argPositionNm(p map[string]any, key string) (*kicadproto.Vector2, error) {
	raw, ok := p[key]
	if !ok || raw == nil {
		return nil, &Error{Code: "BAD_POSITION", Message: key + " is required"}
	}

	m, ok := raw.(map[string]any)
	if !ok {
		return nil, &Error{Code: "BAD_POSITION", Message: key + " must be an object"}
	}

	x, xok := numValue(m["xNm"])
	if !xok {
		x, xok = numValue(m["x"])
	}
	if !xok {
		if v, ok := floatValue(m["xMm"]); ok {
			x, xok = int64(v*1_000_000), true
		}
	}

	y, yok := numValue(m["yNm"])
	if !yok {
		y, yok = numValue(m["y"])
	}
	if !yok {
		if v, ok := floatValue(m["yMm"]); ok {
			y, yok = int64(v*1_000_000), true
		}
	}

	if !xok || !yok {
		return nil, &Error{Code: "BAD_POSITION",
			Message: key + " needs xNm/x/xMm and yNm/y/yMm"}
	}

	return &kicadproto.Vector2{XNm: x, YNm: y}, nil
}

// boardLayer resolves names such as "F.Cu", "B.Cu", or "In1.Cu".
func boardLayer(name string) (kicadproto.BoardLayer, bool) {
	name = strings.TrimSpace(name)
	key := strings.ReplaceAll(name, ".", "_")

	if !strings.HasPrefix(strings.ToUpper(key), "BL_") {
		key = "BL_" + key
	}
	key = strings.ToUpper(key)

	if v, ok := kicadproto.BoardLayer_value[key]; ok {
		return kicadproto.BoardLayer(v), true
	}

	for k, v := range kicadproto.BoardLayer_value {
		if strings.EqualFold(k, key) {
			return kicadproto.BoardLayer(v), true
		}
	}

	return 0, false
}
