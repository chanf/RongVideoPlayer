#!/bin/bash

# Exit on error
set -e

# Visual colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}       Rong VideoPlayer - macOS 打包脚本        ${NC}"
echo -e "${BLUE}==================================================${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[错误] 未检测到 Node.js，请先安装 Node.js!${NC}"
    exit 1
fi

# Check dependencies
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[提示] 未检测到 node_modules，正在安装项目依赖...${NC}"
    npm install
fi

# Determine target
TARGET=$1
if [ -z "$TARGET" ]; then
    echo -e "${YELLOW}请选择打包类型：${NC}"
    echo -e "  1) 打包成免安装 .app 文件夹 (快速本地运行)"
    echo -e "  2) 打包成 .dmg 安装包镜像 (用于分发安装)"
    echo -e "  3) 两者都打包"
    read -p "请输入序号 [1-3] 并回车 (默认 1): " choice
    case $choice in
        2) TARGET="dmg" ;;
        3) TARGET="all" ;;
        *) TARGET="app" ;;
    esac
fi

# Clean output folder if exists
if [ -d "dist" ]; then
    echo -e "${YELLOW}[清理] 正在清理旧的打包输出文件夹 (dist/)...${NC}"
    rm -rf dist
fi

# Perform build
if [ "$TARGET" == "app" ] || [ "$TARGET" == "1" ]; then
    echo -e "\n${BLUE}[开始] 正在编译免安装 .app 运行程序...${NC}"
    npm run pack
    echo -e "${GREEN}[成功] .app 程序已生成在: ${YELLOW}dist/mac/Rong VideoPlayer.app${NC}"

elif [ "$TARGET" == "dmg" ] || [ "$TARGET" == "2" ]; then
    echo -e "\n${BLUE}[开始] 正在生成 .dmg 安装包镜像...${NC}"
    npm run dist
    echo -e "${GREEN}[成功] .dmg 镜像已生成在: ${YELLOW}dist/Rong VideoPlayer-1.0.0.dmg${NC}"

elif [ "$TARGET" == "all" ] || [ "$TARGET" == "3" ]; then
    echo -e "\n${BLUE}[1/2] 正在编译免安装 .app 运行程序...${NC}"
    npm run pack
    echo -e "${GREEN}[成功] .app 程序已生成在: ${YELLOW}dist/mac/Rong VideoPlayer.app${NC}"
    
    echo -e "\n${BLUE}[2/2] 正在生成 .dmg 安装包镜像...${NC}"
    npm run dist
    echo -e "${GREEN}[成功] .dmg 镜像已生成在: ${YELLOW}dist/Rong VideoPlayer-1.0.0.dmg${NC}"
else
    echo -e "${RED}[错误] 无效的打包参数: $TARGET${NC}"
    exit 1
fi

echo -e "\n${GREEN}==================================================${NC}"
echo -e "${GREEN}             🎉 打包工作流已全部完成！              ${NC}"
echo -e "${GREEN}==================================================${NC}"
