// SPDX-License-Identifier: GPL-3.0-or-later
// Package engineering owns the versioned reference pack and evidence gates.
// Frontends discover/call these actions; they never decide engineering acceptance.
package engineering

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

//go:embed catalog.json examples.json
var files embed.FS

type Source struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	Authority   string `json:"authority"`
	Version     string `json:"version"`
	CheckedAt   string `json:"checkedAt"`
	AccessScope string `json:"accessScope"`
	Limitations string `json:"limitations"`
}
type Rule struct {
	ID           string   `json:"id"`
	Kind         string   `json:"kind"`
	Requirement  string   `json:"requirement"`
	Verification string   `json:"verification"`
	SourceIDs    []string `json:"sourceIds"`
}
type Topic struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Stage    string   `json:"stage"`
	Aliases  []string `json:"aliases"`
	Inputs   []string `json:"requiredInputs"`
	Rules    []Rule   `json:"rules"`
	Sources  []string `json:"sourceIds"`
	Tools    []string `json:"tools"`
	Evidence []string `json:"requiredEvidence"`
}
type Pack struct {
	Schema         int      `json:"schemaVersion"`
	Version        string   `json:"version"`
	Language       string   `json:"language"`
	Policy         string   `json:"policy"`
	AuthorityOrder []string `json:"authorityOrder"`
	Sources        []Source `json:"sources"`
	Topics         []Topic  `json:"topics"`
}

func Catalog() Pack {
	var p Pack
	raw, _ := files.ReadFile("catalog.json")
	if err := json.Unmarshal(raw, &p); err != nil {
		panic(err)
	}
	return p
}
func str(p map[string]any, k string) string { v, _ := p[k].(string); return v }
func bad(msg string) error                  { return &backend.Error{Code: "BAD_INPUT", Message: msg} }
func selected(p Pack, q, stage string) []Topic {
	q = strings.ToLower(strings.TrimSpace(q))
	type hit struct {
		topic Topic
		score int
	}
	hits := []hit{}
	for _, t := range p.Topics {
		if stage != "" && stage != "all" && t.Stage != stage && t.ID != stage {
			continue
		}
		score := 0
		if q == "" {
			score = 1
		} else {
			for _, s := range append([]string{t.ID, t.Title}, t.Aliases...) {
				if strings.Contains(q, strings.ToLower(s)) {
					score += 10
				}
			}
			for _, word := range strings.Fields(q) {
				if len([]rune(word)) >= 2 && strings.Contains(strings.ToLower(t.Title+" "+t.ID+" "+strings.Join(t.Aliases, " ")), word) {
					score++
				}
			}
		}
		if score > 0 {
			hits = append(hits, hit{t, score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	out := []Topic{}
	for _, h := range hits {
		out = append(out, h.topic)
	}
	return out
}
func sourcesFor(p Pack, ts []Topic) []Source {
	ids := map[string]bool{}
	for _, t := range ts {
		for _, id := range t.Sources {
			ids[id] = true
		}
	}
	out := []Source{}
	for _, s := range p.Sources {
		if ids[s.ID] {
			out = append(out, s)
		}
	}
	return out
}
func Reference(action string, p map[string]any) (*backend.Result, error) {
	pack := Catalog()
	var data any
	switch action {
	case "reference.get":
		id := str(p, "id")
		found := false
		for _, t := range pack.Topics {
			if t.ID == id {
				data = map[string]any{"version": pack.Version, "topic": t, "sources": sourcesFor(pack, []Topic{t})}
				found = true
				break
			}
		}
		if !found {
			return nil, bad("unknown reference id; use reference.search")
		}
	case "reference.search", "reference.plan":
		ts := selected(pack, str(p, "query"), str(p, "stage"))
		if str(p, "stage") != "" && len(selected(pack, "", str(p, "stage"))) == 0 {
			return nil, bad("unknown stage/topic; use reference.search without a stage")
		}
		limit := 6
		if action == "reference.plan" {
			limit = len(pack.Topics)
		}
		if n, ok := p["limit"].(float64); ok {
			if n < 1 || n > 20 || n != float64(int(n)) {
				return nil, bad("limit must be an integer in 1..20")
			}
			limit = int(n)
		}
		matchKind := "topic-match"
		if action == "reference.plan" && len(ts) == 0 && str(p, "stage") == "" {
			// A broad/unrecognized request must not yield an empty safety plan.
			ts = append(selected(pack, "", "requirements"), selected(pack, "", "verification")...)
			matchKind = "baseline-only; refine query or use reference.search to select task-specific cards"
		}
		total := len(ts)
		if len(ts) > limit {
			ts = ts[:limit]
		}
		if action == "reference.search" {
			summaries := []map[string]any{}
			for _, t := range ts {
				summaries = append(summaries, map[string]any{"id": t.ID, "title": t.Title, "stage": t.Stage, "ruleCount": len(t.Rules), "requiredInputs": t.Inputs})
			}
			data = map[string]any{"version": pack.Version, "count": total, "topics": summaries, "next": "reference.get with a returned id; reference.plan for stage constraints"}
		} else {
			data = map[string]any{"version": pack.Version, "matchKind": matchKind, "policy": pack.Policy, "authorityOrder": pack.AuthorityOrder, "count": total, "topics": ts, "sources": sourcesFor(pack, ts), "unknownInputPolicy": "Do independent work first; list unresolved design decisions. Never invent safety/manufacturing/interface constraints or mark unknown evidence passed.", "releasePolicy": "Use release.template/snapshot/check; workflow flags are task tracking only. Fabrication evidence and production qualification are separate."}
		}
	case "reference.examples":
		var index struct {
			Schema    int               `json:"schemaVersion"`
			Generated string            `json:"generatedAt"`
			Examples  []json.RawMessage `json:"examples"`
		}
		raw, _ := files.ReadFile("examples.json")
		if err := json.Unmarshal(raw, &index); err != nil {
			return nil, err
		}
		matches := []json.RawMessage{}
		for _, e := range index.Examples {
			var v struct {
				ID      string `json:"id"`
				Name    string `json:"name"`
				Project string `json:"project"`
			}
			_ = json.Unmarshal(e, &v)
			if q := strings.ToLower(str(p, "query")); q != "" && !strings.Contains(strings.ToLower(v.ID+" "+v.Name+" "+v.Project), q) {
				continue
			}
			if b, _ := p["includeFiles"].(bool); b {
				matches = append(matches, e)
			} else {
				summary, _ := json.Marshal(map[string]any{"id": v.ID, "name": v.Name, "project": v.Project, "reviewStatus": "indexed-not-electrically-qualified"})
				matches = append(matches, summary)
			}
		}
		data = map[string]any{"count": len(matches), "total": len(index.Examples), "generatedAt": index.Generated, "examples": matches, "warning": "Local demos inventory, not production approval; hashes are the indexed source snapshot. Verify current files before reuse; never modify original demos."}
	default:
		return nil, bad(fmt.Sprintf("unknown reference action %q", action))
	}
	return &backend.Result{OK: true, Action: action, Data: data}, nil
}

// Inventory binds the installed reference service to its exact embedded content.
func Inventory() map[string]any {
	p := Catalog()
	raw, _ := files.ReadFile("catalog.json")
	examples, _ := files.ReadFile("examples.json")
	h := sha256.Sum256(append(raw, examples...))
	rules := 0
	for _, t := range p.Topics {
		rules += len(t.Rules)
	}
	var index struct {
		Examples []json.RawMessage `json:"examples"`
	}
	_ = json.Unmarshal(examples, &index)
	return map[string]any{"version": p.Version, "topicCount": len(p.Topics), "ruleCount": rules, "sourceCount": len(p.Sources), "exampleProjectCount": len(index.Examples), "contentSha256": hex.EncodeToString(h[:])}
}
