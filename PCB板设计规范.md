# KiCad 工程设计参考与放行规范

版本：2026-10-20.1。本地规则为工程政策，不将教程升级为法定标准。

## 自动调用

终端和扩展在相关设计任务中先调用 `reference.plan`，再按需 `reference.get` / `reference.search`；无需斜杠命令。`reference.examples` 查询所有原生示例。制造交付使用 `release.template` 和 `release.check`。

## 使用边界

本库是项目工程约束与检查方法，不是付费标准全文或工业认证。资料按需加载，任何未知参数都不生成通用安全默认值。

性能等级、工艺能力和工业温度分别确认。不把 Class 3、3W、20H、固定线宽或安全距离当作所有产品的默认值。缺少输入时先完成独立工作，列出受影响决策，不猜测。

自动关卡核对当前快照、原生报告与证据文件完整性，不能认证报告真伪、责任人身份或实物合格。最终放行由责任工程师/质量及制造方承担。

## 需求、风险、可靠性和标准适用性

阶段：`spec`；编号：`requirements`

需要输入：用途/市场/失效后果；输入电源与接口；温湿度/海拔/寿命/振动；成本、尺寸、维修和制造目标。

- **REQUIREMENTS-01** 建立需求到电路、规则、测试和交付物的追踪矩阵；未知项显式列出。检查：逐项记录指标、单位、容差、验证方法、责任人和版本。
- **REQUIREMENTS-02** 分别选择性能等级、制造工艺能力和元器件环境等级；最高可靠性目标须落实到可验证需求。检查：查适用 IPC/产品标准、合同版本及供应商能力，不把工业级等同于 Class 3。
- **REQUIREMENTS-03** 按产品使用环境完成风险分析、失效模式与关键特性分级。检查：审查电击、发热、火灾、反接、失控及单点失效的缓解和试验。
- **REQUIREMENTS-04** 记录电源、信号和机械接口预算及允许变化。检查：对需求边界、瞬态、容差、启动及异常工况做最坏情况分析。
- **REQUIREMENTS-05** 每个关卡保留设计快照和证据；未验证不得标通过。检查：将待办与证据验收分开；源文件变化后重新检查。

证据：requirements、risk-register、standards-applicability。

来源：[ipc-design](https://www.ipc.org/ipc-design-standards)、[ipc-dfm](https://www.ipc.org/design-manufacturing-confirmed-ipc-standards)、[kicad-sch](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)。

## 原理图拓扑与电气审查

阶段：`schematic`；编号：`schematic`

需要输入：完整器件数据表/勘误；功能框图与接口定义；电源树/时序/电平。

- **SCHEMATIC-01** 依据实际功能和数据表设计电路，不依靠名称猜测引脚或参考值。检查：逐网络核对方向、电气类型、供电域、绝对最大值与工作范围。
- **SCHEMATIC-02** 层次页、全局标签、总线成员和多单元器件必须完整一致。检查：检查所有子页、跨页网络、共用编号、隐藏电源引脚和未连接脚的意图。
- **SCHEMATIC-03** 启动、复位、boot、调试和时钟应覆盖上电/掉电与异常状态。检查：审查上拉下拉、strap 采样、时序、调试连接及恢复通道。
- **SCHEMATIC-04** ERC 运行全部级别并复核例外；禁止靠改引脚类型、PWR_FLAG 或屏蔽错误伪造通过。检查：每个 no-connect、PWR_FLAG 和例外有电路依据和审查证据。
- **SCHEMATIC-05** 仿真按模型适用范围和边界条件执行，仿真与实物分别验收。检查：保留模型来源/版本、测试平台、角落条件及实测差异。

证据：schematic-review、erc-report、simulation-where-applicable。

来源：[kicad-sch](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)、[phils-lab](https://www.youtube.com/watch?v=aVUqaB0IMh4)。

## 器件选型、降额与供应链

阶段：`schematic`；编号：`parts`

需要输入：制造商完整料号和封装后缀；工作角落和寿命目标；采购/替代策略。

- **PARTS-01** 完整料号、封装、电压温度等级和生命周期必须可追溯。检查：BOM 包含制造商、MPN、数据表版本与 DNP/变体，替代料独立验证。
- **PARTS-02** 按工作温度、容差、偏压和寿命验证额定值及降额。检查：计算电容直流偏压、电阻脉冲功耗、半导体 SOA 与热裕量。
- **PARTS-03** 关键器件和连接器确认可采购、认证与可追溯性。检查：核对渠道、交期、批次、停产风险和防伪计划。
- **PARTS-04** 器件参考电路只对匹配型号/版本/工况成立。检查：逐项比较参考设计电源、负载、频率、封装和 PCB 工艺。

证据：bom-review、derating-analysis、approved-vendor-list。

来源：[kicad-sch](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)、[ipc-design](https://www.ipc.org/ipc-design-standards)。

## 符号、封装、焊盘和 3D 库

阶段：`library`；编号：`footprints`

需要输入：官方封装尺寸图和焊接建议；pin1/底视图/顶视图说明；实际装配工艺与焊盘策略。

- **FOOTPRINTS-01** 符号脚号、焊盘号与数据表逐脚对应，不能用引脚数或外观认封装。检查：核查隐藏脚、散热焊盘、NC/DNU 和多单元编号。
- **FOOTPRINTS-02** 焊盘、阻焊、钢网与散热过孔按实际封装和工艺制定。检查：审查开窗、分割钢网、过孔塞填/盖帽及锡量，原生 DRC 配合板厂确认。
- **FOOTPRINTS-03** 核查本体尺寸、引脚跨距、pin1、courtyard 与装配方向。检查：在 1:1 输出和 3D 装配中对照器件/连接器实际方向。
- **FOOTPRINTS-04** 所有本地符号、封装和模型必须随工程可解析并锁定版本。检查：检查库表、相对路径、依赖快照、许可证及缺失模型；缺失模型不能宣称机械通过。
- **FOOTPRINTS-05** KLC 检查补充库一致性，不替代数据表和制造验收。检查：保留封装审查和板上焊盘/引脚对照记录。

证据：datasheet-pinmap、footprint-review、library-lock。

来源：[klc](https://klc.kicad.org/)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)、[kicad-sch](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)。

## 电源树、开关电源与保护

阶段：`schematic`；编号：`power`

需要输入：各轨电压/瞬态电流/纹波/时序；芯片 EVM 和布局指南；输入浪涌与保护等级。

- **POWER-01** 验证启动、稳态、负载跳变、掉电、反灌和故障的电源预算。检查：保留效率、压降、浪涌、限流、保持时间和稳定性计算/测量。
- **POWER-02** 开关电源高 di/dt 回路紧凑，反馈和敏感信号远离高 dv/dt 节点。检查：逐一标出输入热回路、续流路径、反馈 Kelvin 点和 PGND/AGND 连接。
- **POWER-03** 去耦以器件指南、回路电感和 PDN 目标阻抗决定。检查：核查电容偏压/ESR/ESL/反谐振及电源地过孔回路，不只按距离摆电容。
- **POWER-04** 电源铜、过孔、连接器和热路径按实际电流及温升验算。检查：使用经确认叠层、铜厚和散热边界，不能把线宽经验数值当保证。
- **POWER-05** 输入保护涵盖反接、过压、过流和接口瞬态。检查：核查保险/TVS 选型与协调、接地路径、能量及失效状态。

证据：power-review、power-transient-measurement、pdn-analysis。

来源：[ti-power](https://www.ti.com/video/6245175641001)、[adi-decouple](https://www.analog.com/media/en/training-seminars/tutorials/MT-101.pdf)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)。

## 模拟、ADC/DAC 与采样链

阶段：`schematic`；编号：`analog`

需要输入：精度/噪声/带宽预算；源阻抗和采样时序；器件供电与参考要求。

- **ANALOG-01** 建立增益、偏置、噪声、温漂和容差预算。检查：计算最坏情况并结合 SPICE 模型有效性及实测。
- **ANALOG-02** 模拟数字回流按路径组织，地分割必须有论证。检查：避免敏感信号跨参考缝，AGND/DGND 连接依据器件而非固定套路。
- **ANALOG-03** 采样输入、参考和时钟满足稳定与建立要求。检查：核查抗混叠、驱动稳定、采样电容充电及参考去耦。
- **ANALOG-04** 高阻和微弱信号控制泄漏、污染、热梯度和耦合。检查：按工况审查护环/屏蔽/清洗、布局和测试方法。

证据：analog-error-budget、analog-measurements。

来源：[adi-ground](https://www.analog.com/media/en/training-seminars/tutorials/MT-031.pdf)、[adi-decouple](https://www.analog.com/media/en/training-seminars/tutorials/MT-101.pdf)、[kicad-sch](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)。

## 晶振、时钟与复位时序

阶段：`schematic`；编号：`clock`

需要输入：晶体与 MCU/SoC 专用资料；负载/驱动/频率容差；寄生与温度范围。

- **CLOCK-01** 晶体等效参数、负载、驱动和振荡裕量按实际器件核验。检查：负载电容包含寄生，验证极限电压/温度下启动与稳态。
- **CLOCK-02** 晶振回路紧凑且隔离噪声，布局与接地按芯片指南。检查：核查走线、禁布、地/电源、测试点对振荡器负载的影响。
- **CLOCK-03** 时钟质量和复位满足接收器与电源域要求。检查：测量抖动、占空比、边沿、时序与异常恢复。

证据：clock-review、startup-and-timing-test。

来源：[st-clock](https://www.st.com/resource/en/application_note/an2867-guidelines-for-oscillator-design-on-stm8afals-and-stm32-mcusmpus-stmicroelectronics.pdf)、[ti-highspeed](https://www.ti.com/lit/an/scaa082a/scaa082a.pdf)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)。

## 叠层、参考平面和阻抗

阶段：`board`；编号：`stackup`

需要输入：板厂确认叠层/材料/铜厚；信号边沿和接口目标阻抗；允许损耗/公差/过孔结构。

- **STACKUP-01** 布线前确认层数、参考平面、材料和可制造阻抗结构。检查：获取板厂叠层及阻抗表，计算有效铜厚/介质/阻焊影响并锁定版本。
- **STACKUP-02** 关键信号保持连续参考并给换层提供适当回流。检查：检查跨分割/开槽/平面边缘及返回过孔，不能只检查信号连通。
- **STACKUP-03** 差分与单端约束来自接口和器件资料及叠层解算。检查：核对线宽/间距/损耗/公差，默认值和 3W/20H 仅能作为待验证启发。
- **STACKUP-04** 高速、PDN、散热和工艺权衡必须记录。检查：层数并非质量等级；保留 stackup 审查、阻抗 coupon 与生产要求。

证据：confirmed-stackup、impedance-budget、return-path-review。

来源：[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)、[ti-highspeed](https://www.ti.com/lit/an/scaa082a/scaa082a.pdf)、[rick-hartley](https://podcast.altium.com/e/pc-board-stack-up-best-practices-with-rick-hartley/)、[jlc-capability](https://jlcpcb.com/capabilities/Capabilities?type=1)。

## 布局、结构和可维修性

阶段：`place`；编号：`placement`

需要输入：外壳/连接器/紧固件模型；功能分区和关键回路；装配和调试空间。

- **PLACEMENT-01** 先锁定板框、机械基准、安装孔和连接器再组织功能块。检查：核对公差链、插拔路径、螺钉/支柱、外壳和 PCB 厚度。
- **PLACEMENT-02** 布局优先满足电源回路、时钟、模拟和关键接口拓扑。检查：禁止无约束全板自动摆放，保留锁定器件和人工审查。
- **PLACEMENT-03** 热源、敏感器件及高压区按热、电磁和绝缘约束分布。检查：检查耦合、热梯度、降额、气流及实际工作方向。
- **PLACEMENT-04** 装配、测试、返修和标识有空间与可达性。检查：检查 courtyard、探针、手焊/热风、极性/版本标记及工具操作空间。

证据：mechanical-review、placement-review。

来源：[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)、[phils-lab](https://www.youtube.com/watch?v=aVUqaB0IMh4)、[euro-fiducial](https://www.eurocircuits.com/technical-guidelines/pcb-assembly-guidelines/fiducials/)。

## 布线、过孔、铺铜和连通性

阶段：`route`；编号：`routing`

需要输入：网类/自定义规则及其依据；已确认布局和叠层；敏感/大电流/时序网络清单。

- **ROUTING-01** 线宽、间距、过孔和边缘限制取产品和板厂约束的有效交集。检查：建立 netclass 和自定义规则，复核局部覆盖，禁止为清错放宽规则。
- **ROUTING-02** 先布受约束关键网络，自动布线只能在已确认边界内运行。检查：保护锁定项、回流与功能分区；自动路由完成不代表工程完成。
- **ROUTING-03** 长度/偏斜含封装、过孔和接收端预算，按实际时序选择匹配组。检查：不盲目等长；检查蛇形自耦合、间距、参考和延迟解算。
- **ROUTING-04** 铜区填充后核查孤岛、热连接、细颈和每个端点真实连通。检查：保存快照重新填充检查，逐网络证明无未连，视觉接触不当电气连接。
- **ROUTING-05** 通孔、盲埋孔和微孔选择符合可靠性与工艺资格。检查：审核纵横比、叠孔、填孔/盖帽、钻孔公差和热循环风险。

证据：routing-review、native-drc、connectivity-proof。

来源：[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)、[ti-highspeed](https://www.ti.com/lit/an/scaa082a/scaa082a.pdf)、[ipc-design](https://www.ipc.org/ipc-design-standards)、[jlc-capability](https://jlcpcb.com/capabilities/Capabilities?type=1)。

## DDR、USB、以太网与高速 SI

阶段：`route`；编号：`highspeed`

需要输入：准确 SoC/PHY/存储型号及硬件指南；拓扑/速率/封装延迟；IBIS/S 参数和实际叠层。

- **HIGHSPEED-01** 每种接口采用对应器件/版本的拓扑与约束，不套其他芯片的长度表。检查：建立源端到终端 pin-to-pin 约束，记录 byte lane、组内/组间预算。
- **HIGHSPEED-02** 阻抗、端接、回流、stub 与连接器整体评估。检查：将封装/过孔/ESD/连接器纳入通道分析，按需要做 SI 仿真和眼图实测。
- **HIGHSPEED-03** 等长、换层和串扰基于延迟与预算验证。检查：区分差分内偏斜与组间时序，检查参考平面、模式转换及蛇形耦合。
- **HIGHSPEED-04** 高速电源与时钟裕量和功能测试联合验收。检查：保留最坏角落、训练/压力测试、误码/眼图和 PDN 证据。

证据：interface-constraint-table、si-pi-analysis、interface-lab-tests。

来源：[ti-highspeed](https://www.ti.com/lit/an/scaa082a/scaa082a.pdf)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)。

## RF、天线、ESD 与 EMC

阶段：`route`；编号：`rf-emc`

需要输入：频段/天线/外壳及认证目标；RF 器件参考版图；端口耦合和试验要求。

- **RF-EMC-01** 射频匹配、馈线和禁布遵循实际器件与天线参考并保留调试能力。检查：核查叠层/参考地/匹配器件寄生，装壳后用 VNA/射频测试验证。
- **RF-EMC-02** 外部接口的屏蔽和瞬态电流路径靠近入口并降低耦合。检查：分析 TVS/机壳地/信号地连接，检查回路电感、隔离及保护器件额定值。
- **RF-EMC-03** EMC 从电流回路与共模路径控制，不依赖事后随机加磁珠。检查：审查时钟谐波、连接线、屏蔽接缝、滤波与布局并做预一致性测试。
- **RF-EMC-04** 适用的发射、抗扰度和无线测试由实际产品与市场确定。检查：保留配置、样机版本、试验条件、实验室报告与整改闭环。

证据：rf-emc-review、emc-test-report。

来源：[nordic-rf](https://docs.nordicsemi.com/r/bundle/ps_nrf52832/page/ref_circuitry.html)、[ti-highspeed](https://www.ti.com/lit/an/scaa082a/scaa082a.pdf)、[rick-hartley](https://podcast.altium.com/e/pc-board-stack-up-best-practices-with-rick-hartley/)。

## 绝缘、安规和功能安全适用性

阶段：`spec`；编号：`safety`

需要输入：产品标准/销售地区；工作/瞬态电压和绝缘等级；污染等级/材料组/海拔。

- **SAFETY-01** 确定适用产品标准和法规后由合格人员制定绝缘及试验要求。检查：标准全文/版本/适用范围和审批可追溯，公共目录不能代替条款判断。
- **SAFETY-02** 爬电与电气间隙分别计算并覆盖所有铜层、焊盘和机械路径。检查：核对槽孔、涂覆资格、污染、海拔、材料和装配公差，禁止固定通用毫米数。
- **SAFETY-03** 保护接地、隔离件、保险和故障能量按风险验证。检查：审核认证器件工作电压/瞬态、故障分析、耐压/接地/泄漏试验。
- **SAFETY-04** 汽车、医疗、航空或功能安全声明需要相应过程与资格。检查：通用 PCB 教程、DRC 或 IPC 等级不得当成行业认证。

证据：safety-applicability、safety-review-and-lab-test。

来源：[iec-insulation](https://webstore.iec.ch/en/publication/59671)、[ipc-design](https://www.ipc.org/ipc-design-standards)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)。

## 热设计、寿命与环境可靠性

阶段：`dfm`；编号：`thermal-reliability`

需要输入：真实功耗/负载周期；外壳/气流/环境边界；寿命和环境试验目标。

- **THERMAL-RELIABILITY-01** 最坏功耗下验证结温、器件降额和板上热点。检查：模型边界与热阻适用性需说明，样机热电偶/热像验证不能省略。
- **THERMAL-RELIABILITY-02** 材料、焊点、连接器和重件适合温度循环及机械环境。检查：审查 CTE、铜平衡、固定、共振、焊点疲劳和潮湿污染。
- **THERMAL-RELIABILITY-03** 可靠性计划按失效风险制定应力、样本和合格判据。检查：记录温循/湿热/振动/寿命试验的实际条件、结果和失效分析。
- **THERMAL-RELIABILITY-04** 验证与生产变更必须可追溯到相同硬件/工艺配置。检查：替代料、PCB 材料、叠层和装配工艺变更执行影响分析与再验证。

证据：thermal-analysis-and-measurement、reliability-validation。

来源：[ipc-6012](https://www.ipc.org/news-release/ipc-releases-ipc-6012f-qualification-and-performance-specification-rigid-printed)、[ipc-design](https://www.ipc.org/ipc-design-standards)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)。

## 裸板制造、材料与工艺能力

阶段：`dfm`；编号：`dfm`

需要输入：订单对应工艺规范和日期；确认叠层和材料；制造数据及特殊要求。

- **DFM-01** 制造参数必须来自所选供应商/工艺并锁定来源版本。检查：核对层数、铜厚、最小几何、钻孔、环宽、阻焊和边缘限制，不采用未知默认值。
- **DFM-02** 全局最小规则和局部自定义覆盖都必须满足有效约束。检查：审阅 .kicad_pro/.kicad_dru、禁用检查和规则优先级，保留所有例外依据。
- **DFM-03** 填孔、背钻、控深、边镀、阻抗和特殊材料需专项确认。检查：记录技术要求、能力证明、报价/订单确认与检验方法。
- **DFM-04** 拼板、工艺边、分板和板翘风险与生产线协调。检查：核对连接方式、铜到分板线、V-cut/mouse-bite、治具与重件应力。
- **DFM-05** 制造交付前完成板厂 CAM/DFM 回答闭环。检查：板厂自动检查只是工艺证据，不能替代电气和可靠性审查。

证据：manufacturing-profile、fabricator-confirmation、dfm-review。

来源：[jlc-capability](https://jlcpcb.com/capabilities/Capabilities?type=1)、[euro-class](https://www.eurocircuits.com/technical-guidelines/pcb-design-guidelines/classification/)、[euro-panel](https://www.eurocircuits.com/technical-guidelines/panel-guidelines/)、[ipc-6012](https://www.ipc.org/news-release/ipc-releases-ipc-6012f-qualification-and-performance-specification-rigid-printed)。

## 贴装、钢网、BOM 与工艺

阶段：`manufacturing`；编号：`assembly`

需要输入：实际 BOM/变体和贴片坐标；组装线能力；器件焊接/潮敏要求。

- **ASSEMBLY-01** BOM、CPL、丝印和装配图按最终设计变体一致导出。检查：核查 DNP、位号、坐标原点/单位、底层镜像和旋转的板厂约定。
- **ASSEMBLY-02** 极性、pin1、连接器方向与实际封装逐项复核。检查：不依赖自动坐标文件，保留首件照片和方向检查。
- **ASSEMBLY-03** 钢网和焊盘设计按锡量、桥连、空洞和散热焊盘工艺评审。检查：确认开窗、分割、塞孔与回流曲线、MSL/烘烤要求。
- **ASSEMBLY-04** 基准点、边缘夹持、元件高度和双面工艺符合装配线。检查：由制造方审查全局/局部 fiducial、工具空间、测试与返修。

证据：assembly-review、bom-cpl-review、first-article-inspection。

来源：[euro-fiducial](https://www.eurocircuits.com/technical-guidelines/pcb-assembly-guidelines/fiducials/)、[euro-panel](https://www.eurocircuits.com/technical-guidelines/panel-guidelines/)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)、[klc](https://klc.kicad.org/)。

## 可测试性、烧录与生产测试

阶段：`manufacturing`；编号：`dft`

需要输入：功能验收/覆盖率目标；测试治具与探针能力；固件/密钥和追溯要求。

- **DFT-01** 关键电源、地、复位、调试和接口可安全接入。检查：核对探针间距/支撑/禁布、测量加载与安全操作。
- **DFT-02** 测试步骤覆盖开短路、功能、模拟裕量和边界工况。检查：记录故障覆盖、判据、校准与良品/不良品验证。
- **DFT-03** 烧录、版本、校准和序列号可追溯并支持返修恢复。检查：验证镜像摘要、读回、配置位和测试数据库，不在公开资料中放密钥。
- **DFT-04** 量产测试需治具重复性、节拍及误判评估。检查：保留 GR&R/重复测试、黄金样机、日志与失效处理流程。

证据：dft-review、production-test-plan、fixture-validation。

来源：[kicad-sch](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)、[ipc-dfm](https://www.ipc.org/design-manufacturing-confirmed-ipc-standards)。

## ERC、DRC、连通、规则与版本证据

阶段：`verified`；编号：`verification`

需要输入：保存的完整工程与依赖；需求/规则/制造基线；原生报告和工程审查材料。

- **VERIFICATION-01** 对同一保存快照运行全部级别 ERC/DRC、原理图 PCB 一致性与连通检查。检查：包含排除项/禁用项/所有 track errors、重新填铜和每个子页，不只看错误计数。
- **VERIFICATION-02** 报告缺失、检查未运行、忽略项目或规则依据不明均不得判通过。检查：保留原生 JSON 和工具版本；只改状态或确认布尔值不是证据。
- **VERIFICATION-03** 当前源文件与证据绑定 SHA-256；改变后失效。检查：覆盖子页、本地符号/封装、规则、3D 和制造约束，检查读取期间是否变化。
- **VERIFICATION-04** 静态检查、工程审查和实物测试分层验收。检查：DRC 零错误不证明时序/热/EMC/功能/绝缘/量产良率。
- **VERIFICATION-05** 所有例外有依据、影响、责任人和重验范围。检查：不自动禁用规则、缩小范围或改网名来消除真实缺陷。

证据：native-audit、engineering-review、revision-bound-evidence。

来源：[kicad-cli](https://docs.kicad.org/10.0/en/cli/cli.html)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)、[kicad-sch](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)。

## 制造交付与试产/量产放行

阶段：`manufacturing`；编号：`release`

需要输入：完整版本和变体；制造商确认与审查证据；样机/认证/试产结果。

- **RELEASE-01** 导出制造包必须由同一冻结快照产生并可重现。检查：包含 Gerber/钻孔或约定格式、叠层/制板说明、BOM/CPL、装配图与测试要求及摘要清单。
- **RELEASE-02** 独立查看制造输出并核对板框、孔、层、极性、坐标和版本。检查：不能只看导出进程退出码；与源板、实物方向及板厂 CAM 复核。
- **RELEASE-03** 打样放行与量产放行分开；未知与不适用必须显式解释。检查：关卡输出列出缺失证据和适用条件，AI 不能代签或以状态通过替代审查。
- **RELEASE-04** 量产需功能、热、EMC/安规适用性、可靠性与试产过程证据。检查：保存真实样机/配置/仪器/条件/批次/良率/失效闭环，文档模板不是实测。
- **RELEASE-05** 可追溯的责任工程师/质量及制造方完成最终放行。检查：工具只核对证据包完整性和摘要，不认证签名、报告真实性或代替法规责任。

证据：release-package-review、prototype-validation、compliance-validation、pilot-process-validation、accountable-release。

来源：[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)、[ipc-dfm](https://www.ipc.org/design-manufacturing-confirmed-ipc-standards)、[ipc-6012](https://www.ipc.org/news-release/ipc-releases-ipc-6012f-qualification-and-performance-specification-rigid-printed)、[euro-panel](https://www.eurocircuits.com/technical-guidelines/panel-guidelines/)。

## KiCad 原生设计与仿真示例索引

阶段：`reference`；编号：`examples`

需要输入：示例对应功能和版本；项目本地路径和文件摘要。

- **EXAMPLES-01** 所有本地 demos 工程仅作为按需参考，保留原始文件。检查：通过 reference.examples 查工程、文件清单和摘要，复制到独立目录后试验。
- **EXAMPLES-02** 复用前检查器件、工艺、规则、许可与时代差异。检查：旧示例、仿真专用或演示板不得直接认定安全或投产就绪。
- **EXAMPLES-03** 学习方法与正式设计证据分开记录。检查：没有逐项核验的参考标记为未审查，不能继承其验收结论。

证据：example-applicability-review。

来源：[kicad-examples](https://gitlab.com/kicad/code/kicad/-/tree/master/demos)、[kicad-sch](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)、[kicad-pcb](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)。

## 来源台账与适用范围

- **kicad-sch** [KiCad Schematic Editor](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)，10.0；核实范围：manual；本机 10.99 开发版须同时核对本机帮助和实际 API；ERC 不证明电路功能。
- **kicad-pcb** [KiCad PCB Editor](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)，10.0；核实范围：manual；规则必须由产品和板厂确认；软件功能不等于制造能力。
- **kicad-cli** [KiCad CLI](https://docs.kicad.org/10.0/en/cli/cli.html)，10.0；核实范围：manual；命令参数以本机 --help 为准，保存快照的检查不代表未保存画布。
- **klc** [KiCad Library Conventions](https://klc.kicad.org/)，living documentation；核实范围：conventions；库贡献规范不等于器件数据表或制造验收标准。
- **ipc-design** [IPC Design Standards](https://www.ipc.org/ipc-design-standards)，public overview checked 2026-10-20；核实范围：public overview only；未收录付费标准全文或尺寸表；项目须取得适用版本并由责任工程师解释。
- **ipc-dfm** [IPC Design for Manufacturing](https://www.ipc.org/design-manufacturing-confirmed-ipc-standards)，public overview；核实范围：public overview only；性能等级、可制造性等级和工业温度范围分别确定，不能混为一个最高等级。
- **ipc-6012** [IPC-6012F Qualification and Performance](https://www.ipc.org/news-release/ipc-releases-ipc-6012f-qualification-and-performance-specification-rigid-printed)，F announcement 2023; verify contracted revision；核实范围：public announcement only；只核实范围，不声称已读取全部标准或适用附录；需供应商合同验收。
- **iec-insulation** [IEC 60664-1 insulation coordination](https://webstore.iec.ch/en/publication/59671)，2020 catalog; check AMD1:2025 and applicable product standard；核实范围：catalog only；未取得标准全文；安全距离取决于电压、污染、海拔、材料和产品标准，不提供通用毫米数。
- **ti-highspeed** [TI High-Speed Layout Guidelines SCAA082A](https://www.ti.com/lit/an/scaa082a/scaa082a.pdf)，Rev A, 2017；核实范围：application note；通用原理参考；具体接口、封装、叠层和器件指南优先，不能把 3W/20H 当通用硬门槛。
- **adi-ground** [ADI MT-031 Grounding Data Converters](https://www.analog.com/media/en/training-seminars/tutorials/MT-031.pdf)，Rev A, 2008；核实范围：tutorial；转换器相关原理，AGND/DGND 的连接按器件要求与回流分析，不机械切地。
- **adi-decouple** [ADI MT-101 Decoupling Techniques](https://www.analog.com/media/en/training-seminars/tutorials/MT-101.pdf)，Rev 0, 2009；核实范围：tutorial；电容值、封装、自谐振与网络阻抗须结合实际 PDN 和器件要求。
- **ti-power** [TI PCB layout guidelines to optimize power supply performance](https://www.ti.com/video/6245175641001)，training video；核实范围：public training page；教程不可替代具体电源芯片 EVM、数据表和稳定性实测；未声称观看全部视频。
- **st-clock** [ST AN2867 Oscillator design guidelines](https://www.st.com/resource/en/application_note/an2867-guidelines-for-oscillator-design-on-stm8afals-and-stm32-mcusmpus-stmicroelectronics.pdf)，AN2867, verify device/current revision；核实范围：application-note search metadata；STM8/STM32 专用，其他器件只参考方法，负载和增益裕量重新计算；本次未逐页审阅。
- **nordic-rf** [Nordic nRF52832 reference circuitry](https://docs.nordicsemi.com/r/bundle/ps_nrf52832/page/ref_circuitry.html)，device product specification；核实范围：official reference page；专用参考设计，匹配值、禁布区和射频布局不能跨型号照搬。
- **jlc-capability** [JLCPCB PCB capabilities](https://jlcpcb.com/capabilities/Capabilities?type=1)，living capabilities checked 2026-10-20；核实范围：capability table；下单的层数、铜厚、材料、孔工艺与订单确认优先；不固化网页最小极限为全局默认。
- **euro-class** [Eurocircuits PCB classification](https://www.eurocircuits.com/technical-guidelines/pcb-design-guidelines/classification/)，living guidelines；核实范围：process guidance；仅适用于所选服务、图形及钻孔等级；须确认报价和工艺。
- **euro-panel** [Eurocircuits panel guidelines](https://www.eurocircuits.com/technical-guidelines/panel-guidelines/)，living guidelines；核实范围：process guidance；工艺边、连接和面板按实际装配线与板厂确认。
- **euro-fiducial** [Eurocircuits assembly fiducials](https://www.eurocircuits.com/technical-guidelines/pcb-assembly-guidelines/fiducials/)，living guidelines；核实范围：assembly guidance；全局/局部基准点的位置、禁布和尺寸按实际贴装能力确认。
- **phils-lab** [Phil’s Lab #65 KiCad STM32 PCB design workflow](https://www.youtube.com/watch?v=aVUqaB0IMh4)，2022-07-05, KiCad 6；核实范围：video description and chapter metadata only；教学来源，不是行业标准；未声称观看全部视频。03:54 MCU、26:59 晶振、42:54 ERC、49:25 封装、57:03 布局、1:32:45 DRC、1:35:21 制造输出。
- **rick-hartley** [Rick Hartley: PC Board Stack-up Best Practices](https://podcast.altium.com/e/pc-board-stack-up-best-practices-with-rick-hartley/)，2018-07-24；核实范围：interview and public transcript；用于理解叠层、参考平面与 EMI，实际板需计算和测试，不照搬示例层数。
- **kicad-examples** [KiCad source examples](https://gitlab.com/kicad/code/kicad/-/tree/master/demos)，local checkout inventory；核实范围：local project file inventory with SHA-256；全量索引不表示逐个完成电气审查；历史示例和仿真工程不能直接认定可生产。

## 原生示例

已索引 37 个 `.kicad_pro`，以本地文件清单和 SHA-256 为依据。索引不声称每个例子已完成工程审查；详见 `reference.examples`。
