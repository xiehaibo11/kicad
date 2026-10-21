// SPDX-License-Identifier: GPL-3.0-or-later
package engineering

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/designaudit"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadactions"
)

func put(t *testing.T, p string, v any) {
	t.Helper()
	var raw []byte
	switch x := v.(type) {
	case string:
		raw = []byte(x)
	default:
		raw, _ = json.Marshal(x)
	}
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(p, raw, 0600); e != nil {
		t.Fatal(e)
	}
}
func TestPackTraceabilityAndCallableTools(t *testing.T) {
	p := Catalog()
	ids := map[string]bool{}
	actions := map[string]bool{}
	rules := map[string]bool{}
	for _, a := range kicadactions.All() {
		actions[a.Name] = true
	}
	for _, s := range p.Sources {
		if ids[s.ID] || s.Authority == "" || s.AccessScope == "" || s.Limitations == "" || !strings.HasPrefix(s.URL, "https://") {
			t.Fatalf("invalid source %+v", s)
		}
		ids[s.ID] = true
	}
	for _, topic := range p.Topics {
		if len(topic.Inputs) == 0 || len(topic.Evidence) == 0 {
			t.Fatal(topic.ID)
		}
		for _, r := range topic.Rules {
			if rules[r.ID] || len(r.SourceIDs) == 0 || r.Verification == "" {
				t.Fatal(r.ID)
			}
			rules[r.ID] = true
			for _, id := range r.SourceIDs {
				if !ids[id] {
					t.Fatal(id)
				}
			}
		}
		for _, a := range topic.Tools {
			if !actions[a] {
				t.Fatalf("uncallable reference tool %s in %s", a, topic.ID)
			}
		}
	}
	if len(p.Topics) < 20 || len(rules) < 80 {
		t.Fatal("incomplete lifecycle coverage")
	}
}
func TestSearchChineseAndStage(t *testing.T) {
	p := Catalog()
	for _, q := range []string{"给 DDR 高速信号定约束", "审查原理图和封装", "量产投产检查"} {
		if len(selected(p, q, "")) == 0 {
			t.Fatal(q)
		}
	}
	if _, e := Reference("reference.plan", map[string]any{"stage": "unknown-stage"}); e == nil {
		t.Fatal("unknown stage accepted")
	}
	res, e := Reference("reference.plan", map[string]any{"stage": "schematic"})
	if e != nil || res.Data.(map[string]any)["count"].(int) < 3 {
		t.Fatalf("%v %v", res, e)
	}
	if len(selected(p, "", "highspeed")) != 1 {
		t.Fatal("topic filter")
	}
	res, e = Reference("reference.examples", nil)
	if e != nil || res.Data.(map[string]any)["count"] != 37 {
		t.Fatalf("%v %v", res, e)
	}
}
func fixture(t *testing.T) (string, Manifest) {
	root := t.TempDir()
	pro := filepath.Join(root, "unit.kicad_pro")
	put(t, pro, `{"board":{}}`)
	put(t, filepath.Join(root, "unit.kicad_pcb"), "test board")
	put(t, filepath.Join(root, "unit.kicad_sch"), "test root")
	put(t, filepath.Join(root, "sub", "child.kicad_sch"), "child")
	put(t, filepath.Join(root, "lib.pretty", "part.kicad_mod"), "footprint")
	put(t, filepath.Join(root, "manufacturing.json"), map[string]any{"supplier": "fixture supplier", "process": "fixture process", "source": "fixture specification", "revision": "revision 1", "confirmedAt": "2026-10-20", "stackup": "fixture stackup", "orderApplicability": "fixture order"})
	s, e := SnapshotProject(pro)
	if e != nil {
		t.Fatal(e)
	}
	m := template(s, "production")
	m.Product = Product{Name: "synthetic fixture", Revision: "revision 1", Requirements: "fixture requirements", Environment: "fixture environment", Process: "fixture process", Standards: []string{"fixture only - no certification"}, Features: map[string]string{}}
	for _, f := range optionalFeatures {
		m.Product.Features[f] = "applicable"
	}
	put(t, filepath.Join(root, "evidence", "review.txt"), "Synthetic test evidence only. Never a real design release.")
	h, _ := hashFile(filepath.Join(root, "evidence", "review.txt"))
	for i := range m.Reviews {
		m.Reviews[i].Status = "pass"
		m.Reviews[i].Reviewer = "synthetic reviewer for automated test"
		m.Reviews[i].ReviewedAt = time.Now().UTC().Format(time.RFC3339)
		m.Reviews[i].SnapshotDigest = s.Digest
		m.Reviews[i].Artifacts = []Artifact{{Path: "evidence/review.txt", SHA256: h}}
	}
	return pro, m
}
func nativePass(context.Context, string, map[string]any) (*backend.Result, error) {
	return &backend.Result{OK: true, Data: designaudit.Report{NativeChecksPassed: true, Checks: []designaudit.Check{{Name: "native-drc", Status: "pass"}, {Name: "native-erc", Status: "pass"}}}}, nil
}
func check(t *testing.T, pro string, m Manifest, run designaudit.Dispatcher) ReleaseReport {
	t.Helper()
	path := filepath.Join(filepath.Dir(pro), "release-manifest.json")
	put(t, path, m)
	res, e := Release(context.Background(), "release.check", map[string]any{"project": pro, "target": m.Target, "manifest": path}, run)
	if e != nil {
		t.Fatal(e)
	}
	return res.Data.(ReleaseReport)
}
func TestCompleteSyntheticEvidenceDoesNotGrantProductionApproval(t *testing.T) {
	pro, m := fixture(t)
	r := check(t, pro, m, nativePass)
	if !r.FabricationEvidenceComplete || !r.ProductionEvidenceComplete || r.ReadyForFabrication || r.ReadyForProduction {
		t.Fatalf("incorrect approval %+v", r)
	}
}
func TestReleaseBlocksMissingStaleForgedAndEscapingEvidence(t *testing.T) {
	for _, kind := range []string{"missing-review", "boolean-placeholder", "stale-child", "stale-footprint", "changed-artifact", "escape", "unknown-feature", "unreviewed-na", "native-failure", "during-audit-design", "during-audit-artifact", "duplicate", "unknown-provenance"} {
		t.Run(kind, func(t *testing.T) {
			pro, m := fixture(t)
			root := filepath.Dir(pro)
			run := designaudit.Dispatcher(nativePass)
			switch kind {
			case "missing-review":
				m.Reviews = m.Reviews[1:]
			case "boolean-placeholder":
				m.Reviews[0].Artifacts = nil
			case "stale-child":
				put(t, filepath.Join(root, "sub", "child.kicad_sch"), "changed child")
			case "stale-footprint":
				put(t, filepath.Join(root, "lib.pretty", "part.kicad_mod"), "changed footprint")
			case "changed-artifact":
				put(t, filepath.Join(root, "evidence", "review.txt"), "changed evidence")
			case "escape":
				outside := filepath.Join(t.TempDir(), "outside.txt")
				put(t, outside, "outside")
				h, _ := hashFile(outside)
				m.Reviews[0].Artifacts = []Artifact{{Path: outside, SHA256: h}}
			case "unknown-feature":
				m.Product.Features["highspeed"] = "unknown"
			case "unreviewed-na":
				for i := range m.Reviews {
					if m.Reviews[i].Category == "highspeed" {
						m.Reviews[i].Status = "not-applicable"
						m.Reviews[i].Reason = "because I guessed"
					}
				}
			case "native-failure":
				run = func(context.Context, string, map[string]any) (*backend.Result, error) {
					return &backend.Result{OK: false, Data: designaudit.Report{NativeChecksPassed: false}}, nil
				}
			case "during-audit-design":
				run = func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
					put(t, filepath.Join(root, "sub", "child.kicad_sch"), "race")
					return nativePass(ctx, a, p)
				}
			case "during-audit-artifact":
				run = func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
					put(t, filepath.Join(root, "evidence", "review.txt"), "race")
					return nativePass(ctx, a, p)
				}
			case "duplicate":
				m.Reviews = append(m.Reviews, m.Reviews[0])
			case "unknown-provenance":
				m.Product.Process = "unknown"
			}
			r := check(t, pro, m, run)
			if r.ProductionEvidenceComplete || r.FabricationEvidenceComplete || len(r.Pending) == 0 {
				t.Fatalf("%s passed", kind)
			}
		})
	}
}
func TestTemplateIsPendingAndSnapshotPortable(t *testing.T) {
	pro, _ := fixture(t)
	res, e := Release(context.Background(), "release.template", map[string]any{"project": pro}, nil)
	if e != nil {
		t.Fatal(e)
	}
	m := res.Data.(map[string]any)["manifest"].(Manifest)
	r := check(t, pro, m, nativePass)
	if r.FabricationEvidenceComplete || len(r.Pending) < 10 {
		t.Fatal("blank template passed")
	}
	s, _ := SnapshotProject(pro)
	if s.Files["sub/child.kicad_sch"] == "" || s.Files["lib.pretty/part.kicad_mod"] == "" {
		t.Fatal("nested dependencies missing")
	}
	put(t, filepath.Join(filepath.Dir(pro), "second.kicad_pro"), "{}")
	if _, e := SnapshotProject(filepath.Dir(pro)); e == nil {
		t.Fatal("ambiguous project guessed")
	}
}

func TestFabricationAndProductionEvidenceRemainSeparate(t *testing.T) {
	pro, m := fixture(t)
	m.Reviews = m.Reviews[:len(fabricationCategories)]
	r := check(t, pro, m, nativePass)
	if !r.FabricationEvidenceComplete || r.ProductionEvidenceComplete || r.ReadyForFabrication || r.ReadyForProduction {
		t.Fatalf("fabrication/production conflated: %+v", r)
	}
}
func TestSnapshotIncludesHiddenLibrariesAndRejectsSymlink(t *testing.T) {
	pro, _ := fixture(t)
	root := filepath.Dir(pro)
	put(t, filepath.Join(root, ".project-libs", "device.kicad_sym"), "symbol")
	s, e := SnapshotProject(pro)
	if e != nil || s.Files[".project-libs/device.kicad_sym"] == "" {
		t.Fatal("hidden library omitted", e)
	}
	if e = os.Symlink(filepath.Join(root, "unit.kicad_sch"), filepath.Join(root, "linked.kicad_sch")); e != nil {
		t.Fatal(e)
	}
	if _, e = SnapshotProject(pro); e == nil {
		t.Fatal("symlink silently trusted")
	}
}

func TestBroadPlanStillRequiresBaselineAndIsNotCompleteCoverage(t *testing.T) {
	res, e := Reference("reference.plan", map[string]any{"query": "PCB"})
	if e != nil {
		t.Fatal(e)
	}
	d := res.Data.(map[string]any)
	if d["count"].(int) < 2 || !strings.Contains(d["matchKind"].(string), "baseline-only") {
		t.Fatalf("empty or overclaimed plan: %v", d)
	}
}
func TestChangingManifestDuringNativeAuditBlocksEvidence(t *testing.T) {
	pro, m := fixture(t)
	run := func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
		put(t, filepath.Join(filepath.Dir(pro), "release-manifest.json"), "{}")
		return nativePass(ctx, a, p)
	}
	r := check(t, pro, m, run)
	if r.FabricationEvidenceComplete || r.ProductionEvidenceComplete {
		t.Fatal("changed manifest accepted")
	}
}

func TestExampleIndexCoversActualSourceAndIndexedHashes(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", "..", "..", "..", ".."))
	demos := filepath.Join(root, "demos")
	if _, e := os.Stat(demos); e != nil {
		t.Skip("source examples not included in this package distribution")
	}
	var index struct {
		Examples []struct {
			Project string     `json:"project"`
			Files   []Artifact `json:"files"`
		} `json:"examples"`
	}
	raw, _ := files.ReadFile("examples.json")
	if e := json.Unmarshal(raw, &index); e != nil {
		t.Fatal(e)
	}
	indexed := map[string]bool{}
	for _, example := range index.Examples {
		indexed[example.Project] = true
		for _, a := range example.Files {
			h, e := hashFile(filepath.Join(root, a.Path))
			if e != nil || h != a.SHA256 {
				t.Fatalf("stale indexed reference %s", a.Path)
			}
		}
	}
	actual := 0
	e := filepath.WalkDir(demos, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && filepath.Ext(p) == ".kicad_pro" {
			actual++
			rel, _ := filepath.Rel(root, p)
			if !indexed[filepath.ToSlash(rel)] {
				t.Errorf("original project omitted: %s", rel)
			}
		}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	if actual != len(index.Examples) {
		t.Fatalf("index count %d != source count %d", len(index.Examples), actual)
	}
}

func TestManifestRejectsTrailingDataAndReadyBoolean(t *testing.T) {
	for _, kind := range []string{"trailing", "unknown-ready"} {
		t.Run(kind, func(t *testing.T) {
			pro, m := fixture(t)
			raw, _ := json.Marshal(m)
			if kind == "trailing" {
				raw = append(raw, []byte(` {"readyForProduction":true}`)...)
			} else {
				var data map[string]any
				_ = json.Unmarshal(raw, &data)
				data["readyForProduction"] = true
				raw, _ = json.Marshal(data)
			}
			path := filepath.Join(filepath.Dir(pro), "manifest.json")
			put(t, path, string(raw))
			res, e := Release(context.Background(), "release.check", map[string]any{"project": pro, "target": "production", "manifest": path}, nativePass)
			if e != nil {
				t.Fatal(e)
			}
			r := res.Data.(ReleaseReport)
			if res.OK || r.ProductionEvidenceComplete || r.ReadyForProduction {
				t.Fatal("ambiguous/forged manifest passed")
			}
		})
	}
}
