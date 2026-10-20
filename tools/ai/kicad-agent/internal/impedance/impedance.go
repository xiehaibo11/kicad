// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package impedance implements controlled-impedance analysis and synthesis
// from a KiCad board stackup.
//
// Formulas follow the IPC-2141 closed-form approximations used by most PCB
// calculators.  They are intended for design guidance, not sign-off; final
// impedances must be verified with the fabricator's field solver.
package impedance

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

type LayerInfo struct {
	Name string  `json:"name"`
	Kind string  `json:"kind"` // microstrip | stripline
	Er   float64 `json:"er"`

	// HeightMm is the distance to the nearest reference plane.  It drives the
	// differential coupling term.
	HeightMm float64 `json:"heightMm"`

	// PlaneSpacingMm is the distance between the two reference planes of a
	// stripline (b in the IPC-2141 formula).  For microstrip it equals
	// HeightMm.
	PlaneSpacingMm    float64 `json:"planeSpacingMm"`
	CopperThicknessMm float64 `json:"copperThicknessMm"`
}

type Request struct {
	Layer        LayerInfo `json:"layer"`
	TargetOhm    float64   `json:"targetOhm,omitempty"`
	WidthMm      float64   `json:"widthMm,omitempty"`
	GapMm        float64   `json:"gapMm,omitempty"`
	Differential bool      `json:"differential,omitempty"`
	Synthesize   bool      `json:"synthesize,omitempty"`
}

type Result struct {
	Layer             string  `json:"layer"`
	Kind              string  `json:"kind"`
	Er                float64 `json:"er"`
	HeightMm          float64 `json:"heightMm"`
	PlaneSpacingMm    float64 `json:"planeSpacingMm"`
	CopperThicknessMm float64 `json:"copperThicknessMm"`
	WidthMm           float64 `json:"widthMm"`
	GapMm             float64 `json:"gapMm,omitempty"`
	Z0Ohm             float64 `json:"z0Ohm"`
	ZDiffOhm          float64 `json:"zdiffOhm,omitempty"`
	TargetOhm         float64 `json:"targetOhm,omitempty"`
	ErrorPct          float64 `json:"errorPct,omitempty"`
}

// MicrostripZ0 implements the IPC-2141 microstrip approximation.
func MicrostripZ0(er, h, w, t float64) float64 {
	if er <= 0 || h <= 0 || w <= 0 || t < 0 {
		return 0
	}

	ratio := 5.98 * h / (0.8*w + t)

	if ratio <= 1 {
		return 0
	}

	return 87.0 / math.Sqrt(er+1.41) * math.Log(ratio)
}

// StriplineZ0 implements the IPC-2141 stripline approximation, where aSpacing
// is the distance between the two reference planes (not the dielectric on one
// side).
func StriplineZ0(er, spacing, w, t float64) float64 {
	if er <= 0 || spacing <= 0 || w <= 0 || t < 0 {
		return 0
	}

	ratio := 4.0 * spacing / (0.67 * math.Pi * w * (0.8 + t/w))

	if ratio <= 1 {
		return 0
	}

	return 60.0 / math.Sqrt(er) * math.Log(ratio)
}

// DifferentialZ converts a single-ended impedance to an edge-coupled
// differential impedance.  Stripline and microstrip use different coupling
// coefficients in IPC-2141.
func DifferentialZ(kind string, z0, gap, h float64) float64 {
	if z0 <= 0 || h <= 0 || gap <= 0 {
		return 0
	}

	if kind == "stripline" {
		return 2.0 * z0 * (1.0 - 0.347*math.Exp(-2.9*gap/h))
	}

	return 2.0 * z0 * (1.0 - 0.48*math.Exp(-0.96*gap/h))
}

func differentialFactor(kind string, gap, h float64) float64 {
	if kind == "stripline" {
		return 0.347 * math.Exp(-2.9*gap/h)
	}
	return 0.48 * math.Exp(-0.96*gap/h)
}

func (l LayerInfo) normalized() LayerInfo {
	if l.Kind == "" {
		l.Kind = "microstrip"
	}
	if l.PlaneSpacingMm <= 0 {
		l.PlaneSpacingMm = l.HeightMm
	}
	return l
}

// Validate rejects parameters for which the closed forms are undefined.
func (l LayerInfo) Validate() error {
	l = l.normalized()

	if l.Kind != "microstrip" && l.Kind != "stripline" {
		return fmt.Errorf("layer kind must be microstrip or stripline, got %q", l.Kind)
	}
	if l.Er <= 0 {
		return fmt.Errorf("layer %s has a non-positive dielectric constant", l.Name)
	}
	if l.HeightMm <= 0 {
		return fmt.Errorf("layer %s has no dielectric height", l.Name)
	}
	if l.PlaneSpacingMm <= 0 {
		return fmt.Errorf("layer %s has no plane spacing", l.Name)
	}
	if l.CopperThicknessMm < 0 {
		return fmt.Errorf("layer %s has a negative copper thickness", l.Name)
	}

	return nil
}

func (l LayerInfo) singleEnded(w float64) float64 {
	l = l.normalized()

	if l.Kind == "stripline" {
		return StriplineZ0(l.Er, l.PlaneSpacingMm, w, l.CopperThicknessMm)
	}

	return MicrostripZ0(l.Er, l.HeightMm, w, l.CopperThicknessMm)
}

func (l LayerInfo) validWidth(w float64) bool {
	l = l.normalized()

	reference := l.HeightMm
	if l.Kind == "stripline" {
		reference = l.PlaneSpacingMm
	}

	ratio := w / reference
	return ratio >= 0.1 && ratio <= 2.0
}

// SynthesizeWidth finds the trace width that produces the target impedance.
// It returns an error when the target is outside the reachable range or the
// solution is outside the formula's validity range.
func SynthesizeWidth(l LayerInfo, targetOhm, gapMm float64, differential bool) (float64, error) {
	l = l.normalized()

	if err := l.Validate(); err != nil {
		return 0, err
	}
	if targetOhm <= 0 {
		return 0, fmt.Errorf("targetOhm must be positive")
	}

	desired := targetOhm

	if differential {
		if gapMm <= 0 {
			return 0, fmt.Errorf("gapMm must be positive for a differential pair")
		}

		factor := differentialFactor(l.Kind, gapMm, l.HeightMm)

		if factor >= 1.0 {
			return 0, fmt.Errorf("invalid differential coupling geometry")
		}

		desired = targetOhm / (2.0 * (1.0 - factor))
	}

	// IPC-2141 is only valid for 0.1 <= w/h (or w/b) <= 2.0.
	reference := l.HeightMm
	if l.Kind == "stripline" {
		reference = l.PlaneSpacingMm
	}

	lo, hi := 0.1*reference, 2.0*reference

	zLo := l.singleEnded(lo)
	zHi := l.singleEnded(hi)

	if zLo <= 0 || zHi <= 0 {
		return 0, fmt.Errorf("impedance formula is invalid at the synthesis bounds")
	}

	// Higher impedance means a narrower trace.
	if desired > zLo {
		return 0, fmt.Errorf("target %.2f ohm is unreachable: minimum width %.2f mm gives %.2f ohm",
			targetOhm, lo, zLo)
	}
	if desired < zHi {
		return 0, fmt.Errorf("target %.2f ohm is unreachable: maximum width %.2f mm gives %.2f ohm",
			targetOhm, hi, zHi)
	}

	for i := 0; i < 100; i++ {
		mid := (lo + hi) / 2
		z := l.singleEnded(mid)

		if z > desired {
			lo = mid
		} else {
			hi = mid
		}
	}

	width := (lo + hi) / 2
	z := l.singleEnded(width)

	if z <= 0 || math.Abs(z-desired)/desired > 0.005 {
		return 0, fmt.Errorf("could not synthesize a stable width for %.2f ohm", targetOhm)
	}
	if !l.validWidth(width) {
		return 0, fmt.Errorf("synthesized width %.4f mm is outside the IPC-2141 validity range", width)
	}

	return width, nil
}

func Analyze(req Request) (Result, error) {
	layer := req.Layer.normalized()

	if layer.Name == "" {
		return Result{}, fmt.Errorf("layer is required")
	}
	if err := layer.Validate(); err != nil {
		return Result{}, err
	}
	if req.Differential && req.GapMm <= 0 {
		return Result{}, fmt.Errorf("gapMm must be positive for a differential pair")
	}

	width := req.WidthMm

	if width <= 0 || req.Synthesize {
		var err error
		width, err = SynthesizeWidth(layer, req.TargetOhm, req.GapMm, req.Differential)
		if err != nil {
			return Result{}, err
		}
	}

	if width <= 0 {
		return Result{}, fmt.Errorf("could not determine trace width")
	}
	if !layer.validWidth(width) {
		return Result{}, fmt.Errorf("width %.4f mm is outside the IPC-2141 validity range", width)
	}

	z0 := layer.singleEnded(width)

	if z0 <= 0 {
		return Result{}, fmt.Errorf("geometry produces a non-physical impedance")
	}

	result := Result{
		Layer:             layer.Name,
		Kind:              layer.Kind,
		Er:                layer.Er,
		HeightMm:          layer.HeightMm,
		PlaneSpacingMm:    layer.PlaneSpacingMm,
		CopperThicknessMm: layer.CopperThicknessMm,
		WidthMm:           width,
		GapMm:             req.GapMm,
		Z0Ohm:             z0,
		TargetOhm:         req.TargetOhm,
	}

	if req.Differential {
		result.ZDiffOhm = DifferentialZ(layer.Kind, z0, req.GapMm, layer.HeightMm)

		if result.ZDiffOhm <= 0 {
			return Result{}, fmt.Errorf("geometry produces a non-physical differential impedance")
		}
		if req.TargetOhm > 0 {
			result.ErrorPct = (result.ZDiffOhm - req.TargetOhm) / req.TargetOhm * 100
		}
	} else if req.TargetOhm > 0 {
		result.ErrorPct = (result.Z0Ohm - req.TargetOhm) / req.TargetOhm * 100
	}

	return result, nil
}

// nmNumber accepts protojson int64 (a JSON string) or a plain number.
type nmNumber float64

func (n *nmNumber) UnmarshalJSON(data []byte) error {
	text := strings.TrimSpace(string(data))

	if text == "" || text == "null" {
		*n = 0
		return nil
	}

	if text[0] == '"' {
		unquoted, err := strconv.Unquote(text)
		if err != nil {
			return fmt.Errorf("invalid nanometer value %s", text)
		}
		text = strings.TrimSpace(unquoted)
	}

	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return fmt.Errorf("invalid nanometer value %q", text)
	}
	if value < 0 {
		return fmt.Errorf("nanometer value must not be negative")
	}

	*n = nmNumber(value)
	return nil
}

type rawLayer struct {
	Layer     string `json:"layer"`
	Type      string `json:"type"`
	Enabled   *bool  `json:"enabled"`
	Thickness *struct {
		ValueNm nmNumber `json:"valueNm"`
	} `json:"thickness"`
	Dielectric *struct {
		Layer []struct {
			EpsilonR  float64 `json:"epsilonR"`
			LossTan   float64 `json:"lossTangent"`
			Thickness struct {
				ValueNm nmNumber `json:"valueNm"`
			} `json:"thickness"`
		} `json:"layer"`
	} `json:"dielectric"`
}

type rawStackup struct {
	Layers []rawLayer `json:"layers"`
}

func (l rawLayer) isEnabled() bool {
	return l.Enabled == nil || *l.Enabled
}

// dielectricParams sums every physical sublayer and derives a series-weighted
// effective dielectric constant, matching how KiCad computes stackup
// thickness.
func dielectricParams(layer rawLayer) (thicknessNm, er float64, err error) {
	if layer.Dielectric == nil || len(layer.Dielectric.Layer) == 0 {
		return 0, 0, nil
	}

	var sumT, sumTR float64

	for _, sub := range layer.Dielectric.Layer {
		t := float64(sub.Thickness.ValueNm)

		if t <= 0 {
			continue
		}
		if sub.EpsilonR <= 0 {
			return 0, 0, fmt.Errorf("dielectric sublayer has a non-positive epsilonR")
		}
		if sub.LossTan < 0 {
			return 0, 0, fmt.Errorf("dielectric sublayer has a negative loss tangent")
		}

		sumT += t
		sumTR += t / sub.EpsilonR
	}

	if sumT <= 0 || sumTR <= 0 {
		return 0, 0, fmt.Errorf("dielectric layer has no physical thickness")
	}

	return sumT, sumT / sumTR, nil
}

func layerDisplayName(protoName string) string {
	name := strings.TrimPrefix(protoName, "BL_")
	return strings.ReplaceAll(name, "_", ".")
}

// LayersFromStackup parses the JSON produced by board.stackup.read and returns
// the copper layers with their adjacent dielectric information.
func LayersFromStackup(stackupJSON []byte) ([]LayerInfo, error) {
	var stackup rawStackup
	if err := json.Unmarshal(stackupJSON, &stackup); err != nil {
		return nil, fmt.Errorf("parse stackup: %w", err)
	}

	var copperIndices []int

	for i, layer := range stackup.Layers {
		if layer.Type == "BSLT_COPPER" && layer.Layer != "" && layer.isEnabled() {
			copperIndices = append(copperIndices, i)
		}
	}

	var layers []LayerInfo

	for pos, i := range copperIndices {
		layer := stackup.Layers[i]

		aboveIdx := findDielectric(stackup.Layers, i-1, -1)
		belowIdx := findDielectric(stackup.Layers, i+1, 1)

		isTop := pos == 0
		isBottom := pos == len(copperIndices)-1

		kind := "microstrip"
		heightNm := 0.0
		spacingNm := 0.0
		er := 0.0

		if !isTop && !isBottom && aboveIdx >= 0 && belowIdx >= 0 {
			kind = "stripline"

			tAbove, erAbove, err := dielectricParams(stackup.Layers[aboveIdx])
			if err != nil {
				return nil, fmt.Errorf("layer %s: %w", layerDisplayName(layer.Layer), err)
			}

			tBelow, erBelow, err := dielectricParams(stackup.Layers[belowIdx])
			if err != nil {
				return nil, fmt.Errorf("layer %s: %w", layerDisplayName(layer.Layer), err)
			}

			spacingNm = tAbove + tBelow
			heightNm = (tAbove + tBelow) / 2
			er = spacingNm / (tAbove/erAbove + tBelow/erBelow)
		} else {
			dielectricIdx := aboveIdx

			if isTop || (!isBottom && belowIdx >= 0 && aboveIdx < 0) {
				dielectricIdx = belowIdx
			}

			if dielectricIdx >= 0 {
				t, e, err := dielectricParams(stackup.Layers[dielectricIdx])
				if err != nil {
					return nil, fmt.Errorf("layer %s: %w", layerDisplayName(layer.Layer), err)
				}

				heightNm = t
				spacingNm = t
				er = e
			}
		}

		var copperNm float64
		if layer.Thickness != nil {
			copperNm = float64(layer.Thickness.ValueNm)
		}

		layers = append(layers, LayerInfo{
			Name:              layerDisplayName(layer.Layer),
			Kind:              kind,
			Er:                er,
			HeightMm:          heightNm / 1e6,
			PlaneSpacingMm:    spacingNm / 1e6,
			CopperThicknessMm: copperNm / 1e6,
		})
	}

	if len(layers) == 0 {
		return nil, fmt.Errorf("stackup contains no enabled copper layers")
	}

	return layers, nil
}

func findDielectric(layers []rawLayer, start, direction int) int {
	for i := start; i >= 0 && i < len(layers); i += direction {
		if layers[i].Type == "BSLT_DIELECTRIC" && layers[i].isEnabled() {
			return i
		}
	}
	return -1
}

func FindLayer(layers []LayerInfo, name string) (LayerInfo, bool) {
	for _, layer := range layers {
		if strings.EqualFold(layer.Name, name) {
			return layer, true
		}
	}
	return LayerInfo{}, false
}
