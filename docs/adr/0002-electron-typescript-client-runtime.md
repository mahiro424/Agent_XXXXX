# Electron + TypeScript 作为客户端与 Runtime 基线

首轮 Demo 使用 Electron + React + TypeScript 同时承载桌面客户端与 Agent Runtime Worker，因为该技术栈可以最快复用现有 CLI/Skill 基础、快速验证产品闭环，并能通过 IPC 与独立 sidecar 组合；Tauri/Rust 因学习成本与生态差异暂不作为首轮实现。该选择未来可迁移：Runtime 通过协议与 UI 解耦，Windows Bridge 与文档引擎均为独立进程，因此迁移 Tauri 不需要重写核心逻辑。
