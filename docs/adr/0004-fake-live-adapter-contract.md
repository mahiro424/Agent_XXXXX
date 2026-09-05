# Fake/Live Adapter 契约

Demo 阶段提供 Fake Model、Fake Bridge 与 Fake Document Engine，与 Live Adapter 使用同一公共接口，确保不依赖 API Key、网络和真实桌面也能跑通完整闭环；后续逐个替换真实能力时，运行时、UI 与测试无需改动。该决策也用于自动化测试：Fake 适配器可确定性注入暂停、失败和结果不确定状态。
