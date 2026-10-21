// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package kicadactions

// coreKeywords are natural-language triggers for the established actions, so
// Chinese and English requests reach them without slash commands.
var coreKeywords = map[string][]string{
	"system.health":             {"环境检查", "健康检查", "连接状态", "IPC", "health", "status"},
	"project.open":              {"打开工程", "启动API", "open project"},
	"document.save":             {"保存", "save"},
	"document.revert":           {"恢复", "重新加载", "revert", "reload"},
	"board.items.get":           {"读取元件", "列出走线", "list items"},
	"board.items.create":        {"创建", "添加走线", "add track"},
	"board.items.update":        {"修改", "移动器件", "update"},
	"board.items.delete":        {"删除", "delete"},
	"board.connectivity.prove":  {"连通性", "过孔连平面", "是否连通", "connectivity", "via to plane"},
	"board.layers.get":          {"层", "板层", "layers"},
	"board.stackup.read":        {"叠层", "层叠结构", "stackup"},
	"board.stackup.write":       {"修改叠层", "板厚", "介电常数"},
	"board.zones.refill":        {"重新铺铜", "填充铺铜", "refill zones"},
	"board.netlist.import":      {"导入网表", "原理图更新到PCB", "update pcb from schematic"},
	"board.place.autoplace":     {"自动布局", "自动摆放", "autoplace"},
	"board.fanout.run":          {"BGA扇出", "扇出", "狗骨", "盘中孔", "fanout", "dogbone"},
	"board.plane.create":        {"内电层", "铺铜", "平面", "plane"},
	"board.plane.verify":        {"验证平面", "铺铜验证"},
	"board.drc.run":             {"DRC", "设计规则检查", "检查违规", "design rule check"},
	"board.render":              {"渲染", "3D图", "预览图", "render"},
	"board.impedance.layers":    {"阻抗", "叠层参数"},
	"board.impedance.calculate": {"阻抗计算", "线宽计算", "impedance"},
	"board.impedance.check":     {"阻抗检查", "受控阻抗"},
	"board.dfm.analyze":         {"可制造性", "DFM", "线宽检查"},
	"board.dfm.fix":             {"DFM修复", "加宽走线"},
	"board.route.autoroute":     {"自动布线", "布线", "autoroute", "route"},
	"board.route.diff_pair":     {"差分对", "差分布线", "diff pair", "USB", "LVDS"},
	"board.route.length_report": {"走线长度", "长度报告", "length"},
	"board.route.tune_length":   {"蛇形线", "调长度", "等长", "tune length"},
	"board.check.3d":            {"3D检查", "结构检查", "高度", "碰撞"},
	"board.export.gerbers":      {"Gerber", "光绘", "生产文件"},
	"board.export.drill":        {"钻孔文件", "drill"},
	"board.export.position":     {"坐标文件", "贴片文件", "pick and place"},
	"board.export.step":         {"STEP", "3D模型导出"},
	"board.export.svg":          {"SVG"},
	"board.export.pdf":          {"PDF", "打印"},
	"board.export.png":          {"PNG", "图片"},
	"board.export.ipc2581":      {"IPC-2581"},
	"board.export.odb":          {"ODB++"},
	"board.diff":                {"PCB对比", "版本差异"},
	"board.nets.get":            {"网络列表", "nets"},
	"board.items.by_net":        {"按网络查找"},
	"board.rules.get":           {"设计规则", "规则读取", "rules"},
	"board.rules.set":           {"设置规则", "最小线宽", "最小间距"},
	"board.rules.custom.get":    {"自定义规则"},
	"board.rules.custom.set":    {"自定义规则设置", "DRU"},
	"board.flip":                {"翻转", "放到背面", "flip"},
	"board.titleblock.set":      {"标题栏"},
	"schematic.items.get":       {"原理图元素", "读取原理图"},
	"schematic.erc.run":         {"ERC", "电气规则检查"},
	"schematic.place.symbol":    {"放置符号", "放元件", "place symbol"},
	"schematic.annotate":        {"标注", "位号", "annotate"},
	"schematic.generate":        {"生成原理图", "画原理图", "generate schematic"},
	"schematic.netlist.get":     {"原理图网表"},
	"schematic.export.netlist":  {"导出网表", "SPICE网表"},
	"schematic.export.bom":      {"BOM", "物料清单"},
	"schematic.export.pdf":      {"原理图PDF"},
	"library.search.symbols":    {"搜索符号", "找元件", "symbol search"},
	"library.get.symbol":        {"符号详情", "引脚"},
	"library.search.footprints": {"搜索封装", "找封装", "footprint search"},
	"kicad.cli.run":             {"kicad-cli", "命令行"},
	"external.freerouting.run":  {"Freerouting", "自动布线器"},
	"external.ngspice.run":      {"仿真", "SPICE", "ngspice"},
	"external.step.meshcheck":   {"STEP碰撞", "实体干涉", "collision"},
	"audit.run":                 {"设计评审", "投板评审", "审查", "audit", "review"},
	"audit.footprint":           {"封装审查"},
	"web.search":                {"数据手册", "datasheet", "搜索资料"},
	"web.fetch":                 {"下载手册", "打开网页"},
	"pipeline.run":              {"一键设计", "完整流程", "pipeline"},
}

func applyCoreKeywords(actions []ActionSpec) {
	for i := range actions {
		if len(actions[i].Keywords) == 0 {
			actions[i].Keywords = coreKeywords[actions[i].Name]
		}
		switch actions[i].Name {
		case "board.drc.run":
			actions[i].Inputs = append(actions[i].Inputs,
				"document optional (instead of input: DRC of the open board incl. unsaved edits)",
				"<any kicad-cli pcb drc option, e.g. units, severityError, saveBoard>")
		case "schematic.erc.run":
			actions[i].Inputs = append(actions[i].Inputs,
				"document optional (instead of input: ERC of the open schematic incl. unsaved edits)")
		}
	}
}
