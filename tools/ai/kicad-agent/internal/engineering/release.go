// SPDX-License-Identifier: GPL-3.0-or-later
package engineering

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/designaudit"
)

type Artifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type Snapshot struct {
	Project string            `json:"project"`
	Digest  string            `json:"digest"`
	Files   map[string]string `json:"files"`
}
type Product struct {
	Name         string            `json:"name"`
	Revision     string            `json:"revision"`
	Requirements string            `json:"requirements"`
	Environment  string            `json:"environment"`
	Standards    []string          `json:"standards"`
	Process      string            `json:"manufacturerProcess"`
	Features     map[string]string `json:"features"`
}
type Review struct {
	Category       string     `json:"category"`
	Status         string     `json:"status"`
	Reason         string     `json:"applicabilityReason,omitempty"`
	Reviewer       string     `json:"reviewer"`
	ReviewedAt     string     `json:"reviewedAt"`
	SnapshotDigest string     `json:"snapshotDigest"`
	Artifacts      []Artifact `json:"artifacts"`
}
type Manifest struct {
	SchemaVersion        int      `json:"schemaVersion"`
	Target               string   `json:"target"`
	SnapshotDigest       string   `json:"snapshotDigest"`
	Product              Product  `json:"product"`
	ManufacturingProfile Artifact `json:"manufacturingProfile"`
	Reviews              []Review `json:"reviews"`
}
type ReleaseReport struct {
	ManifestPath                string              `json:"manifestPath,omitempty"`
	ManifestSHA256              string              `json:"manifestSha256,omitempty"`
	PolicyVersion               string              `json:"policyVersion"`
	CreatedAt                   string              `json:"createdAt"`
	Target                      string              `json:"target"`
	Snapshot                    Snapshot            `json:"snapshot"`
	Checks                      []designaudit.Check `json:"checks"`
	Pending                     []string            `json:"pendingEvidence"`
	FabricationEvidenceComplete bool                `json:"fabricationEvidenceComplete"`
	ProductionEvidenceComplete  bool                `json:"productionEvidenceComplete"`
	ReadyForFabrication         bool                `json:"readyForFabrication"`
	ReadyForProduction          bool                `json:"readyForProduction"`
	Scope                       string              `json:"scope"`
}

var optionalFeatures = []string{"analog", "clock", "highspeed", "rf-emc"}
var fabricationCategories = []string{"requirements", "schematic", "parts", "footprints", "power", "analog", "clock", "stackup", "placement", "routing", "highspeed", "rf-emc", "safety", "thermal-reliability", "dfm", "assembly", "dft", "rule-exceptions", "manufacturing-output"}
var productionCategories = []string{"prototype-functional", "thermal-validation", "emc-safety-validation", "reliability-validation", "pilot-process", "release-authorization"}

func hashFile(p string) (string, error) {
	raw, e := os.ReadFile(p)
	if e != nil {
		return "", e
	}
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:]), nil
}
func projectPath(p string) (string, error) {
	if p == "" {
		p = "."
	}
	absolute, e := filepath.Abs(p)
	if e != nil {
		return "", e
	}
	st, e := os.Stat(absolute)
	if e != nil {
		return "", e
	}
	if st.IsDir() {
		matches, e := filepath.Glob(filepath.Join(absolute, "*.kicad_pro"))
		if e != nil {
			return "", e
		}
		if len(matches) != 1 {
			return "", bad("project directory must contain exactly one .kicad_pro; supply the full selected project path")
		}
		absolute = matches[0]
	} else if filepath.Ext(absolute) != ".kicad_pro" {
		return "", bad("project must be a .kicad_pro or its directory")
	}
	return filepath.EvalSymlinks(absolute)
}
func designFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".kicad_pro", ".kicad_sch", ".kicad_pcb", ".kicad_dru", ".kicad_sym", ".kicad_mod", ".step", ".stp", ".wrl", ".cir", ".spice", ".lib", ".sub":
		return true
	}
	switch filepath.Base(path) {
	case "sym-lib-table", "fp-lib-table", "manufacturing.json":
		return true
	}
	return false
}

// SnapshotProject hashes the complete project directory's local design graph,
// including nested sheets/libraries/models. External dependencies require a
// versioned review artifact; they are not silently asserted to be snapshotted.
func SnapshotProject(project string) (Snapshot, error) {
	pro, e := projectPath(project)
	if e != nil {
		return Snapshot{}, e
	}
	root := filepath.Dir(pro)
	snap := Snapshot{Project: pro, Files: map[string]string{}}
	e = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != root && (contains([]string{".git", ".kicad-agent", ".claude", ".vscode", "node_modules"}, d.Name()) || strings.HasSuffix(d.Name(), "-backups") || d.Name() == "migration-backups") {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("design dependency is a symlink; vendor/version it inside the project: %s", p)
		}
		if !designFile(p) {
			return nil
		}
		if !d.Type().IsRegular() {
			return fmt.Errorf("design dependency must be a regular file: %s", p)
		}
		rel, _ := filepath.Rel(root, p)
		h, e := hashFile(p)
		if e != nil {
			return e
		}
		snap.Files[filepath.ToSlash(rel)] = h
		return nil
	})
	if e != nil {
		return Snapshot{}, e
	}
	raw, _ := json.Marshal(snap.Files)
	h := sha256.Sum256(raw)
	snap.Digest = hex.EncodeToString(h[:])
	return snap, nil
}
func contains(items []string, s string) bool {
	for _, v := range items {
		if v == s {
			return true
		}
	}
	return false
}
func meaningful(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return len([]rune(s)) >= 3 && s != "unknown" && s != "pending" && s != "todo" && s != "tbd" && s != "待确认" && s != "待补充"
}
func artifactCheck(root string, a Artifact) error {
	if len(a.SHA256) != 64 {
		return fmt.Errorf("SHA-256 required for %q", a.Path)
	}
	if a.Path == "" || filepath.IsAbs(a.Path) {
		return fmt.Errorf("artifact must be a project-relative path: %q", a.Path)
	}
	full := filepath.Join(root, a.Path)
	resolved, e := filepath.EvalSymlinks(full)
	if e != nil {
		return e
	}
	rel, e := filepath.Rel(root, resolved)
	if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("artifact escapes project: %s", a.Path)
	}
	st, e := os.Stat(resolved)
	if e != nil {
		return e
	}
	if !st.Mode().IsRegular() || st.Size() == 0 {
		return fmt.Errorf("artifact must be a nonempty regular file: %s", a.Path)
	}
	h, e := hashFile(resolved)
	if e != nil {
		return e
	}
	if !strings.EqualFold(h, a.SHA256) {
		return fmt.Errorf("artifact changed: %s", a.Path)
	}
	return nil
}
func template(s Snapshot, target string) Manifest {
	m := Manifest{SchemaVersion: 1, Target: target, SnapshotDigest: s.Digest, Product: Product{Standards: []string{}, Features: map[string]string{}}, ManufacturingProfile: Artifact{Path: "manufacturing.json", SHA256: s.Files["manufacturing.json"]}, Reviews: []Review{}}
	for _, k := range optionalFeatures {
		m.Product.Features[k] = "unknown"
	}
	cats := append([]string{}, fabricationCategories...)
	if target == "production" {
		cats = append(cats, productionCategories...)
	}
	for _, c := range cats {
		m.Reviews = append(m.Reviews, Review{Category: c, Status: "pending", Artifacts: []Artifact{}})
	}
	return m
}
func validateReview(root string, r Review, s Snapshot, p Product) error {
	if r.Status != "pass" {
		if r.Status != "not-applicable" || !contains(optionalFeatures, r.Category) || p.Features[r.Category] != "not-applicable" || !meaningful(r.Reason) {
			return fmt.Errorf("status must be pass, or justified optional feature not-applicable")
		}
	} else if contains(optionalFeatures, r.Category) && p.Features[r.Category] != "applicable" {
		return fmt.Errorf("feature applicability not resolved consistently")
	}
	if !meaningful(r.Reviewer) {
		return fmt.Errorf("accountable reviewer required; AI must not impersonate a reviewer")
	}
	reviewed, e := time.Parse(time.RFC3339, r.ReviewedAt)
	if e != nil || reviewed.After(time.Now().Add(5*time.Minute)) {
		return fmt.Errorf("valid non-future reviewedAt required")
	}
	if r.SnapshotDigest != s.Digest {
		return fmt.Errorf("review is not bound to current snapshot")
	}
	if len(r.Artifacts) == 0 {
		return fmt.Errorf("nonempty review/test artifacts required; booleans and stage labels are not evidence")
	}
	for _, a := range r.Artifacts {
		if e := artifactCheck(root, a); e != nil {
			return e
		}
	}
	return nil
}
func Release(ctx context.Context, action string, p map[string]any, run designaudit.Dispatcher) (*backend.Result, error) {
	s, e := SnapshotProject(str(p, "project"))
	if e != nil {
		return nil, e
	}
	root := filepath.Dir(s.Project)
	if action == "release.snapshot" {
		return &backend.Result{Action: action, OK: true, Data: s}, nil
	}
	target := str(p, "target")
	if target == "" {
		target = "fabrication"
	}
	if target != "fabrication" && target != "production" {
		return nil, bad("target must be fabrication or production")
	}
	if action == "release.template" {
		return &backend.Result{Action: action, OK: true, Data: map[string]any{"snapshot": s, "manifest": template(s, target), "instructions": "Save manifest as JSON, resolve project inputs, attach real revision-bound review/test artifacts and their hashes. This template is deliberately pending. For manufacturing.json provide the five positive-mm limits used by audit.rules plus supplier, process, source URL/document revision, confirmedAt, stackup and order applicability. Never invent limits or reviewer identities."}}, nil
	}
	if action != "release.check" {
		return nil, bad("unknown release action")
	}
	report := ReleaseReport{PolicyVersion: Catalog().Version, CreatedAt: time.Now().UTC().Format(time.RFC3339), Target: target, Snapshot: s, Checks: []designaudit.Check{}, Pending: []string{}, Scope: "Evidence completeness only. Does not authenticate reviewers, signatures, report truth, physical hardware or regulatory certification. readyForFabrication/readyForProduction stay false: accountable external engineering/quality/manufacturer release is required. Workflow flags and templates cannot confer approval."}
	fabricationBlocked := false
	add := func(name string, err error) {
		if err != nil {
			productionOnly := false
			for _, cat := range productionCategories {
				if name == "review."+cat || name == "artifact-stability."+cat {
					productionOnly = true
				}
			}
			if !productionOnly {
				fabricationBlocked = true
			}
			report.Checks = append(report.Checks, designaudit.Check{Name: name, Status: "blocked", Detail: err.Error()})
			report.Pending = append(report.Pending, name+": "+err.Error())
		} else {
			report.Checks = append(report.Checks, designaudit.Check{Name: name, Status: "pass"})
		}
	}
	var m Manifest
	manifestPath := str(p, "manifest")
	if manifestPath != "" {
		report.ManifestPath, _ = filepath.Abs(manifestPath)
		report.ManifestSHA256, _ = hashFile(manifestPath)
	}
	if path := str(p, "manifest"); path == "" {
		add("manifest", fmt.Errorf("missing manifest; use release.template"))
	} else {
		raw, err := os.ReadFile(path)
		if err == nil {
			dec := json.NewDecoder(strings.NewReader(string(raw)))
			dec.DisallowUnknownFields()
			err = dec.Decode(&m)
			if err == nil {
				var extra any
				if dec.Decode(&extra) != io.EOF {
					err = fmt.Errorf("manifest must contain exactly one JSON object")
				}
			}
		}
		add("manifest", err)
	}
	if m.SchemaVersion != 1 {
		add("schema", fmt.Errorf("schemaVersion must be 1"))
	}
	if m.Target != target {
		add("target", fmt.Errorf("manifest target differs; explicitly pass target matching manifest"))
	}
	if m.SnapshotDigest != s.Digest {
		add("snapshot", fmt.Errorf("manifest missing or stale for current design files"))
	} else {
		add("snapshot", nil)
	}
	for k, v := range map[string]string{"product.name": m.Product.Name, "product.revision": m.Product.Revision, "requirements": m.Product.Requirements, "environment": m.Product.Environment, "manufacturerProcess": m.Product.Process} {
		if !meaningful(v) {
			add(k, fmt.Errorf("unresolved project input"))
		}
	}
	if len(m.Product.Standards) == 0 {
		add("standards", fmt.Errorf("applicable standards/contract editions and rationale required"))
	} else {
		for _, v := range m.Product.Standards {
			if !meaningful(v) {
				add("standards", fmt.Errorf("unresolved standard applicability"))
				break
			}
		}
	}
	for _, k := range optionalFeatures {
		v := m.Product.Features[k]
		if v != "applicable" && v != "not-applicable" {
			add("feature."+k, fmt.Errorf("unknown applicability"))
		}
	}
	if m.ManufacturingProfile.Path != "manufacturing.json" {
		add("manufacturing-profile", fmt.Errorf("vendor the confirmed profile as manufacturing.json so it is included in the design snapshot"))
	}
	add("manufacturing-profile-artifact", artifactCheck(root, m.ManufacturingProfile))
	if raw, err := os.ReadFile(filepath.Join(root, "manufacturing.json")); err == nil {
		var cfg map[string]any
		if json.Unmarshal(raw, &cfg) != nil {
			add("manufacturing-provenance", fmt.Errorf("unreadable manufacturing JSON"))
		} else {
			for _, key := range []string{"supplier", "process", "source", "revision", "confirmedAt", "stackup", "orderApplicability"} {
				v, _ := cfg[key].(string)
				if !meaningful(v) {
					add("manufacturing-provenance."+key, fmt.Errorf("manufacturer-confirmed provenance required"))
				}
			}
		}
	}
	reviews := map[string]Review{}
	for _, r := range m.Reviews {
		if _, ok := reviews[r.Category]; ok {
			add("duplicate-review", fmt.Errorf("duplicate category %s", r.Category))
		}
		if !contains(fabricationCategories, r.Category) && !contains(productionCategories, r.Category) {
			add("review-category", fmt.Errorf("unknown category %s", r.Category))
		}
		reviews[r.Category] = r
	}
	cats := append([]string{}, fabricationCategories...)
	if target == "production" {
		cats = append(cats, productionCategories...)
	}
	for _, cat := range cats {
		r, ok := reviews[cat]
		if !ok {
			add("review."+cat, fmt.Errorf("required review missing"))
		} else {
			add("review."+cat, validateReview(root, r, s, m.Product))
		}
	}
	artifacts := []string{}
	board := strings.TrimSuffix(s.Project, ".kicad_pro") + ".kicad_pcb"
	if run == nil {
		add("native-audit", fmt.Errorf("native audit runner unavailable"))
	} else {
		params := map[string]any{"board": board}
		if _, err := os.Stat(filepath.Join(root, "manufacturing.json")); err == nil {
			params["manufacturingProfile"] = filepath.Join(root, "manufacturing.json")
		}
		res, err := run(ctx, "audit.run", params)
		if err != nil {
			add("native-audit", err)
		} else if res == nil {
			add("native-audit", fmt.Errorf("native result missing"))
		} else {
			artifacts = append(artifacts, res.Artifacts...)
			var a designaudit.Report
			raw, _ := json.Marshal(res.Data)
			err = json.Unmarshal(raw, &a)
			if err != nil || !res.OK || !a.NativeChecksPassed || len(a.Checks) == 0 {
				add("native-audit", fmt.Errorf("fresh complete native audit has not passed; see native artifacts"))
			} else {
				add("native-audit", nil)
			}
			report.Checks = append(report.Checks, designaudit.Check{Name: "native-audit-detail", Status: "info", Detail: res.Data})
		}
	}
	// Re-read every dependency and evidence file after running native tools.
	after, err := SnapshotProject(s.Project)
	if err != nil || after.Digest != s.Digest {
		add("snapshot-stability", fmt.Errorf("design changed while checking; rerun against saved stable inputs"))
	} else {
		add("snapshot-stability", nil)
	}
	for _, r := range m.Reviews {
		for _, a := range r.Artifacts {
			add("artifact-stability."+r.Category, artifactCheck(root, a))
		}
	}
	if manifestPath != "" {
		h, err := hashFile(manifestPath)
		if err != nil || h != report.ManifestSHA256 {
			add("manifest-stability", fmt.Errorf("manifest changed during checking"))
		} else {
			add("manifest-stability", nil)
		}
	}
	report.FabricationEvidenceComplete = !fabricationBlocked
	report.ProductionEvidenceComplete = target == "production" && len(report.Pending) == 0
	sort.Strings(report.Pending)
	dir, e := os.MkdirTemp("", "kicad-release-check-*")
	if e != nil {
		return nil, e
	}
	output := filepath.Join(dir, "release-check.json")
	raw, _ := json.MarshalIndent(report, "", "  ")
	if e = os.WriteFile(output, append(raw, '\n'), 0600); e != nil {
		return nil, e
	}
	artifacts = append(artifacts, output)
	res := &backend.Result{Action: action, OK: len(report.Pending) == 0, Data: report, Artifacts: artifacts}
	if !res.OK {
		res.Error = &backend.Error{Code: "RELEASE_EVIDENCE_INCOMPLETE", Message: "Missing, stale or failing evidence; inspect pendingEvidence and native reports. No fabrication/production approval conferred."}
	}
	return res, nil
}
