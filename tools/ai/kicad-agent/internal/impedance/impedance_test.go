// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package impedance

import (
	"math"
	"strings"
	"testing"
)

func TestMicrostripSynthesisRoundTrip(t *testing.T) {
	layer := LayerInfo{
		Name: "F.Cu", Kind: "microstrip", Er: 4.5,
		HeightMm: 1.44, CopperThicknessMm: 0.035,
	}

	width, err := SynthesizeWidth(layer, 50, 0, false)
	if err != nil {
		t.Fatal(err)
	}

	result, err := Analyze(Request{Layer: layer, TargetOhm: 50, Synthesize: true})
	if err != nil {
		t.Fatal(err)
	}

	if math.Abs(result.Z0Ohm-50) > 0.5 {
		t.Fatalf("synthesized Z0 = %.3f, want 50", result.Z0Ohm)
	}
	if math.Abs(result.WidthMm-width) > 1e-6 {
		t.Fatalf("width mismatch: %v vs %v", result.WidthMm, width)
	}
}

func TestStriplineUsesPlaneToPlaneSpacing(t *testing.T) {
	// b = 0.2 mm above + 1.44 mm below, as in the QA stackup fixture.
	layer := LayerInfo{
		Name: "In1.Cu", Kind: "stripline", Er: 4.5,
		HeightMm: 0.82, PlaneSpacingMm: 1.64, CopperThicknessMm: 0.035,
	}

	result, err := Analyze(Request{Layer: layer, TargetOhm: 50, Synthesize: true})
	if err != nil {
		t.Fatal(err)
	}

	if math.Abs(result.Z0Ohm-50) > 0.5 {
		t.Fatalf("synthesized Z0 = %.3f, want 50", result.Z0Ohm)
	}

	// b = 1.64 mm, not the one-sided 0.2 mm.  Using the one-sided value would
	// produce roughly 0.12 mm and a very different impedance.
	if result.WidthMm < 0.5 || result.WidthMm > 0.8 {
		t.Fatalf("unexpected stripline width %.4f mm for b=1.64 mm", result.WidthMm)
	}
}

func TestDifferentialMicrostripAndStripline(t *testing.T) {
	microstrip := LayerInfo{
		Name: "F.Cu", Kind: "microstrip", Er: 4.5,
		HeightMm: 0.2, CopperThicknessMm: 0.035,
	}
	stripline := LayerInfo{
		Name: "In1.Cu", Kind: "stripline", Er: 4.5,
		HeightMm: 0.82, PlaneSpacingMm: 1.64, CopperThicknessMm: 0.035,
	}

	for name, layer := range map[string]LayerInfo{"microstrip": microstrip, "stripline": stripline} {
		t.Run(name, func(t *testing.T) {
			result, err := Analyze(Request{
				Layer: layer, TargetOhm: 90, GapMm: 0.2, Differential: true, Synthesize: true,
			})
			if err != nil {
				t.Fatal(err)
			}

			if result.ZDiffOhm <= 0 {
				t.Fatalf("invalid differential impedance %v", result.ZDiffOhm)
			}
			if math.Abs(result.ErrorPct) > 1.0 {
				t.Fatalf("differential synthesis error %.3f%%", result.ErrorPct)
			}
		})
	}
}

func TestAnalyzeRejectsInvalidParameters(t *testing.T) {
	base := LayerInfo{Name: "F.Cu", Kind: "microstrip", Er: 4.5,
		HeightMm: 0.2, CopperThicknessMm: 0.035}

	tests := []struct {
		name string
		req  Request
	}{
		{"zero er", Request{Layer: LayerInfo{Name: "F.Cu", Kind: "microstrip", Er: 0,
			HeightMm: 0.2, CopperThicknessMm: 0.035}, WidthMm: 0.2}},
		{"zero height", Request{Layer: LayerInfo{Name: "F.Cu", Kind: "microstrip", Er: 4.5},
			WidthMm: 0.2}},
		{"oversized width", Request{Layer: base, WidthMm: 10}},
		{"unreachable target", Request{Layer: base, TargetOhm: 150, Synthesize: true}},
		{"differential without gap", Request{Layer: base, TargetOhm: 90,
			Differential: true, WidthMm: 0.2}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Analyze(tc.req); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestLayersFromStackup(t *testing.T) {
	stackup := []byte(`{
      "layers": [
        {"layer":"BL_F_SilkS","type":"BSLT_SILKSCREEN"},
        {"layer":"BL_F_Cu","type":"BSLT_COPPER","thickness":{"valueNm":"35000"}},
        {"layer":"BL_UNDEFINED","type":"BSLT_DIELECTRIC","dielectric":{"layer":[{"epsilonR":4.5,"thickness":{"valueNm":"200000"}}]}},
        {"layer":"BL_In1_Cu","type":"BSLT_COPPER","thickness":{"valueNm":35000}},
        {"layer":"BL_UNDEFINED","type":"BSLT_DIELECTRIC","dielectric":{"layer":[{"epsilonR":4.5,"thickness":{"valueNm":"1440000"}}]}},
        {"layer":"BL_B_Cu","type":"BSLT_COPPER","thickness":{"valueNm":"35000"}}
      ]
    }`)

	layers, err := LayersFromStackup(stackup)
	if err != nil {
		t.Fatal(err)
	}
	if len(layers) != 3 {
		t.Fatalf("expected 3 copper layers, got %d", len(layers))
	}

	top, ok := FindLayer(layers, "F.Cu")
	if !ok || top.Kind != "microstrip" || top.HeightMm != 0.2 {
		t.Fatalf("unexpected top layer: %+v", top)
	}

	inner, ok := FindLayer(layers, "In1.Cu")
	if !ok || inner.Kind != "stripline" {
		t.Fatalf("unexpected inner layer: %+v", inner)
	}
	if math.Abs(inner.PlaneSpacingMm-1.64) > 1e-9 {
		t.Fatalf("inner plane spacing = %v, want 1.64", inner.PlaneSpacingMm)
	}
	if math.Abs(inner.HeightMm-0.82) > 1e-9 {
		t.Fatalf("inner height = %v, want 0.82", inner.HeightMm)
	}

	bottom, ok := FindLayer(layers, "B.Cu")
	if !ok || bottom.HeightMm != 1.44 {
		t.Fatalf("unexpected bottom layer: %+v", bottom)
	}

	width, err := SynthesizeWidth(inner, 50, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	if width < 0.5 || width > 0.8 {
		t.Fatalf("inner 50 ohm width = %.4f mm, expected roughly 0.62 mm", width)
	}
}

func TestLayersFromStackupSublayersAndDisabled(t *testing.T) {
	stackup := []byte(`{
      "layers": [
        {"layer":"BL_F_Cu","type":"BSLT_COPPER","thickness":{"valueNm":"35000"}},
        {"layer":"BL_UNDEFINED","type":"BSLT_DIELECTRIC","dielectric":{"layer":[
          {"epsilonR":4.5,"thickness":{"valueNm":"100000"}},
          {"epsilonR":4.0,"thickness":{"valueNm":"100000"}}
        ]}},
        {"layer":"BL_In1_Cu","type":"BSLT_COPPER","thickness":{"valueNm":"35000"}},
        {"layer":"BL_UNDEFINED","type":"BSLT_DIELECTRIC","enabled":false,
         "dielectric":{"layer":[{"epsilonR":9.0,"thickness":{"valueNm":"900000"}}]}},
        {"layer":"BL_B_Cu","type":"BSLT_COPPER","thickness":{"valueNm":"35000"}}
      ]
    }`)

	layers, err := LayersFromStackup(stackup)
	if err != nil {
		t.Fatal(err)
	}
	if len(layers) != 3 {
		t.Fatalf("expected 3 layers, got %d: %+v", len(layers), layers)
	}

	top, _ := FindLayer(layers, "F.Cu")
	if math.Abs(top.HeightMm-0.2) > 1e-9 {
		t.Fatalf("top thickness = %v, want 0.2", top.HeightMm)
	}

	// Series-weighted: 0.2 / (0.1/4.5 + 0.1/4.0) = 4.2353.
	if math.Abs(top.Er-4.235294) > 1e-5 {
		t.Fatalf("effective Er = %v, want 4.2353", top.Er)
	}

	inner, _ := FindLayer(layers, "In1.Cu")
	if inner.PlaneSpacingMm != 0.2 {
		t.Fatalf("disabled dielectric should be skipped; spacing = %v", inner.PlaneSpacingMm)
	}
}

func TestLayersFromStackupRejectsInvalidNumbers(t *testing.T) {
	stackup := []byte(`{"layers":[
      {"layer":"BL_F_Cu","type":"BSLT_COPPER","thickness":{"valueNm":"nope"}},
      {"layer":"BL_UNDEFINED","type":"BSLT_DIELECTRIC","dielectric":{"layer":[{"epsilonR":4.5,"thickness":{"valueNm":"100000"}}]}},
      {"layer":"BL_B_Cu","type":"BSLT_COPPER","thickness":{"valueNm":"35000"}}
    ]}`)

	if _, err := LayersFromStackup(stackup); err == nil ||
		!strings.Contains(err.Error(), "invalid nanometer") {
		t.Fatalf("expected a parse error, got %v", err)
	}
}
