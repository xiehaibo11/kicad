// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package kicadactions

import (
	"sort"
	"strings"
	"unicode"
)

// zhSynonyms maps Chinese EDA vocabulary to English search tokens so a request
// such as "帮我把所有铺铜重新填充" finds pcbnew.ZoneFiller.zoneFillAll and
// board.zones.refill without a slash command.
var zhSynonyms = map[string][]string{
	"布线": {"route", "track"}, "走线": {"track", "route"}, "连线": {"wire", "route"},
	"自动布线": {"autoroute", "freerouting", "route"}, "差分": {"diff", "differential", "pair"},
	"等长": {"length", "tune", "match"}, "长度": {"length"}, "蛇形": {"serpentine", "tune", "meander"},
	"扇出": {"fanout", "escape"}, "过孔": {"via"}, "盲孔": {"blind", "via"}, "埋孔": {"buried", "via"},
	"微孔": {"micro", "via"}, "焊盘": {"pad"}, "盘中孔": {"via-in-pad", "fanout", "via"},
	"铺铜": {"zone", "fill", "copper", "pour"}, "覆铜": {"zone", "fill", "copper"}, "敷铜": {"zone", "fill"},
	"填充": {"fill", "refill"}, "填充区": {"zone"}, "内电层": {"plane", "zone", "power", "layer"},
	"电源层": {"plane", "power", "layer"}, "平面": {"plane", "zone"}, "地平面": {"plane", "gnd", "zone"},
	"禁布": {"keepout", "rule", "area"}, "禁止": {"keepout"}, "规则区": {"rule", "area"},
	"规则": {"rules", "constraint", "drc"}, "间距": {"clearance"}, "线宽": {"width", "track"},
	"网络": {"net"}, "网络类": {"netclass", "net", "class"}, "高亮": {"highlight"}, "飞线": {"ratsnest"},
	"器件": {"footprint", "component"}, "元件": {"footprint", "symbol", "component"}, "封装": {"footprint"},
	"符号": {"symbol"}, "原理图": {"schematic", "eeschema", "sch"}, "电路板": {"board", "pcb", "pcbnew"},
	"板子": {"board", "pcb"}, "丝印": {"silkscreen", "silk", "text"}, "阻焊": {"solder", "mask"},
	"钢网": {"paste"}, "锡膏": {"paste"}, "板框": {"edge", "cuts", "outline", "board"}, "外形": {"outline", "edge"},
	"叠层": {"stackup", "layer"}, "层叠": {"stackup"}, "层": {"layer"}, "渲染": {"render", "3d"},
	"导出": {"export", "plot"}, "导入": {"import"}, "光绘": {"gerber", "plot"}, "生产文件": {"gerber", "fabrication", "drill", "export"},
	"投板": {"gerber", "fabrication", "audit"}, "钻孔": {"drill"}, "坐标": {"position", "pos"}, "贴片": {"position", "pos"},
	"物料": {"bom"}, "网表": {"netlist"}, "检查": {"check", "drc", "erc", "audit"}, "设计规则": {"drc", "rules"},
	"电气规则": {"erc"}, "标注": {"annotate"}, "编号": {"annotate", "reference"}, "位号": {"reference", "annotate"},
	"选择": {"select", "selection"}, "全选": {"select", "all"}, "删除": {"delete", "remove"}, "移动": {"move"},
	"旋转": {"rotate"}, "翻转": {"flip"}, "镜像": {"mirror", "flip"}, "对齐": {"align"}, "分布": {"distribute"},
	"复制": {"copy", "duplicate"}, "粘贴": {"paste"}, "撤销": {"undo"}, "重做": {"redo"}, "保存": {"save"},
	"打开": {"open"}, "关闭": {"close"}, "缩放": {"zoom"}, "放大": {"zoom", "in"}, "缩小": {"zoom", "out"},
	"测量": {"measure"}, "尺寸": {"dimension"}, "文字": {"text"}, "文本": {"text"}, "圆": {"circle"},
	"弧": {"arc"}, "矩形": {"rectangle"}, "多边形": {"polygon"}, "网格": {"grid"}, "栅格": {"grid"},
	"原点": {"origin"}, "交叉探测": {"cross", "probe", "selection", "sync"}, "仿真": {"simulator", "spice", "ngspice"},
	"库": {"library"}, "更新": {"update"}, "同步": {"sync", "update"}, "泪滴": {"teardrop"}, "清理": {"cleanup", "clean"},
	"锁定": {"lock"}, "解锁": {"unlock"}, "组": {"group"}, "属性": {"properties"}, "查找": {"find", "search"},
	"替换": {"replace"}, "隐藏": {"hide"}, "显示": {"show", "visible"}, "编辑": {"edit"}, "交换": {"swap"},
	"引脚": {"pin"}, "电源": {"power"}, "地": {"gnd", "ground"}, "标签": {"label"}, "总线": {"bus"},
	"层次": {"hierarchy", "sheet"}, "子图": {"sheet", "hierarchy"}, "不连接": {"no", "connect"}, "节点": {"junction"},
	"电容": {"capacitor", "decap"}, "去耦": {"decap", "decoupling", "capacitor"}, "基准点": {"fiducial"},
	"光学定位": {"fiducial"}, "mark点": {"fiducial"}, "天线": {"antenna", "keepout"}, "阻抗": {"impedance"},
	"计算器": {"calculator"}, "碰撞": {"collision", "step", "3d"}, "结构": {"step", "3d", "structural"},
	"干涉": {"collision", "step"}, "高度": {"height", "3d"}, "数据手册": {"datasheet", "web"},
	"搜索": {"search", "find"}, "制造": {"fabrication", "dfm"}, "可制造": {"dfm"}, "锐角": {"acute", "dfm"},
	"悬空": {"dangling", "dfm"}, "连通": {"connectivity", "prove"}, "连接": {"connectivity", "connected"},
	"变体": {"variant"}, "版本": {"version"}, "健康": {"health"}, "环境": {"health"}, "状态": {"status"},
	"审查": {"audit", "review"}, "评审": {"audit", "review"}, "预览": {"render", "svg", "png"},
	"截图": {"png", "render", "screenshot"}, "图片": {"png", "svg"}, "统计": {"stats"}, "升级": {"upgrade"},
	"对比": {"diff", "compare"}, "差异": {"diff"}, "摆放": {"place", "autoplace"}, "布局": {"place", "autoplace", "placement"},
	"自动布局": {"autoplace", "place"}, "放置": {"place", "add", "draw"}, "添加": {"add", "create", "place", "insert", "draw"}, "创建": {"create", "add", "new"},
	"新建": {"new", "create"}, "修改": {"update", "edit", "modify"}, "设置": {"set", "settings"}, "读取": {"get", "read"},
	"获取": {"get"}, "列出": {"list"}, "工程": {"project"}, "项目": {"project"}, "文档": {"document"},
}

// ExpandQuery tokenizes a natural-language query.  ASCII words are lowered and
// split on punctuation and camelCase; Chinese runs contribute every known
// synonym they contain plus the raw run (matched against translated names).
func ExpandQuery(query string) (tokens []string, cjk []string) {
	seen := map[string]bool{}
	add := func(t string) {
		t = strings.ToLower(strings.TrimSpace(t))
		if len(t) < 2 && !isCJKString(t) || seen[t] {
			return
		}
		seen[t] = true
		tokens = append(tokens, t)
	}

	var word []rune
	var han []rune
	flushWord := func() {
		if len(word) > 0 {
			for _, part := range splitCamel(string(word)) {
				add(part)
			}
			add(string(word))
			word = word[:0]
		}
	}
	flushHan := func() {
		if len(han) > 0 {
			run := string(han)
			cjk = append(cjk, run)
			lowerRun := strings.ToLower(run)
			for term, syn := range zhSynonyms {
				if strings.Contains(lowerRun, term) {
					for _, s := range syn {
						add(s)
					}
				}
			}
			han = han[:0]
		}
	}

	for _, r := range query {
		switch {
		case unicode.Is(unicode.Han, r):
			flushWord()
			han = append(han, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushHan()
			word = append(word, r)
		default:
			flushWord()
			flushHan()
		}
	}
	flushWord()
	flushHan()

	// ASCII words that are themselves synonym keys (e.g. "mark点" written
	// half in Latin) are covered above; also expand "drc"-style acronyms
	// verbatim.
	return tokens, cjk
}

func isCJKString(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// splitCamel splits "zoomFitScreen" or "SingleTrack" into words.
func splitCamel(s string) []string {
	var out []string
	var cur []rune
	runes := []rune(s)
	for i, r := range runes {
		if i > 0 && unicode.IsUpper(r) && (unicode.IsLower(runes[i-1]) ||
			(i+1 < len(runes) && unicode.IsLower(runes[i+1]))) {
			out = append(out, string(cur))
			cur = cur[:0]
		}
		cur = append(cur, r)
	}
	if len(cur) > 0 {
		out = append(out, string(cur))
	}
	return out
}

// bigramScore counts Chinese two-character chunks of query found in text, a
// segmentation-free fuzzy match.
func bigramScore(query, text string) int {
	if query == "" || text == "" {
		return 0
	}
	q := []rune(query)
	if len(q) == 1 {
		if strings.ContainsRune(text, q[0]) {
			return 1
		}
		return 0
	}
	score := 0
	for i := 0; i+1 < len(q); i++ {
		if strings.Contains(text, string(q[i:i+2])) {
			score++
		}
	}
	return score
}

// scoreText scores one candidate given expanded tokens and raw Chinese runs.
// fields are weighted: name/identity text counts more than descriptions.
func scoreText(tokens, cjk []string, primary, secondary, zh string) int {
	primary = strings.ToLower(primary)
	secondary = strings.ToLower(secondary)
	primaryWords := map[string]bool{}
	for _, w := range strings.FieldsFunc(primary, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		primaryWords[w] = true
		for _, part := range splitCamel(w) {
			primaryWords[strings.ToLower(part)] = true
		}
	}

	score := 0
	for _, t := range tokens {
		weight := 6
		if genericVerbs[t] {
			weight = 3 // verbs disambiguate less than the object being acted on
		}
		switch {
		case primaryWords[t]:
			score += weight
		case strings.Contains(primary, t):
			score += 3
		case strings.Contains(secondary, t):
			score += 2
		}
	}
	for _, run := range cjk {
		if zh == "" {
			continue
		}
		if strings.Contains(zh, run) {
			score += 12
			if strings.HasPrefix(zh, run+" ") || zh == run {
				score += 10 // the translated name is exactly the request
			}
		}
		score += 3 * bigramScore(run, zh)
	}
	return score
}

var genericVerbs = map[string]bool{
	"add": true, "create": true, "place": true, "insert": true, "draw": true, "new": true,
	"get": true, "set": true, "list": true, "edit": true, "update": true, "modify": true,
	"delete": true, "remove": true, "show": true, "run": true, "read": true, "check": true,
}

// ActionMatch is a scored catalog search hit.
type ActionMatch struct {
	ActionSpec
	Score int `json:"score"`
}

// SearchActions ranks typed actions for a natural-language query.  An empty
// result never falls back to "everything"; callers decide what to show.
func SearchActions(query string, limit int) []ActionMatch {
	tokens, cjk := ExpandQuery(query)
	var out []ActionMatch
	for _, a := range All() {
		primary := a.Name + " " + strings.Join(a.Keywords, " ")
		secondary := a.Description + " " + strings.Join(a.Inputs, " ")
		zh := strings.Join(a.Keywords, " ") + " " + a.Description
		s := scoreText(tokens, cjk, primary, secondary, zh)
		if s > 0 {
			out = append(out, ActionMatch{ActionSpec: a, Score: s})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Name < out[j].Name
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
