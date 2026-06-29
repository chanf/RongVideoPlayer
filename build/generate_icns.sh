#!/bin/bash
set -e

INPUT_IMAGE=$1
OUTPUT_DIR="build"

if [ -z "$INPUT_IMAGE" ] || [ ! -f "$INPUT_IMAGE" ]; then
    echo "Error: Please specify a valid input image path."
    echo "Usage: ./generate_icns.sh <path_to_image>"
    exit 1
fi

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"
ICONSET_DIR="$OUTPUT_DIR/icon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

echo "Scaling and converting images for macOS iconset using sips..."
sips -s format png -z 16 16     "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null 2>&1
sips -s format png -z 32 32     "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null 2>&1
sips -s format png -z 32 32     "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null 2>&1
sips -s format png -z 64 64     "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null 2>&1
sips -s format png -z 128 128   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null 2>&1
sips -s format png -z 256 256   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null 2>&1
sips -s format png -z 256 256   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null 2>&1
sips -s format png -z 512 512   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null 2>&1
sips -s format png -z 512 512   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null 2>&1
sips -s format png -z 1024 1024 "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null 2>&1

echo "Compiling icon.icns using iconutil..."
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_DIR/icon.icns"

echo "Cleaning up temporary files..."
rm -rf "$ICONSET_DIR"

echo "Successfully generated $OUTPUT_DIR/icon.icns!"
