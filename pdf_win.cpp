// pdf_win.cpp - Windows native PDF helper for Rong VideoPlayer.
//
// Mirrors the CLI contract of pdf_render_mac.swift so the renderer/main IPC
// layer does not need to know which platform it is on:
//
//   pdf_win.exe info <pdf-path>
//     stdout: {"success":true,"pageCount":N,"title":"..."}
//
//   pdf_win.exe render <pdf-path> <page-index> <scale> <output-path>
//     writes PNG to <output-path>
//     stdout: {"success":true,"pageIndex":N,"width":W,"height":H,"outputPath":"..."}
//
// On any failure, stdout is `{"success":false,"error":"..."}` and exit code is 1.
//
// Uses pdfium (FPDF_* API from bblanchon/pdfium-binaries) for parsing/rendering
// and stb_image_write for PNG encoding. argv is consumed via wmain so non-ASCII
// (e.g. Chinese) paths round-trip cleanly through UTF-8 to pdfium.

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"  // single-header MIT: https://github.com/nothings/stb

#include <fpdfview.h>
#include <fpdf_doc.h>

#include <windows.h>
#include <shlobj.h>            // SHCreateDirectory (recursive)

#include <algorithm>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <iostream>
#include <string>
#include <vector>
#include <sstream>

// ---------------------------------------------------------------------------
// Minimal JSON helpers (output shape is fixed, so hand-rolling is enough).
// ---------------------------------------------------------------------------
static std::string jsonEscape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 2);
  for (unsigned char c : s) {
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

static void emitJSON(const std::string& json) {
  std::cout << json << "\n";
  std::cout.flush();
}

[[noreturn]] static void fail(const std::string& message) {
  emitJSON("{\"success\":false,\"error\":\"" + jsonEscape(message) + "\"}");
  std::exit(1);
}

// ---------------------------------------------------------------------------
// UTF-16 (wchar_t on Windows) -> UTF-8 converters.
// ---------------------------------------------------------------------------
static std::string wideToUtf8(const wchar_t* w) {
  if (!w) return "";
  int needed = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  if (needed <= 0) return "";
  std::string out(static_cast<size_t>(needed), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, -1, out.data(), needed, nullptr, nullptr);
  if (!out.empty() && out.back() == '\0') out.pop_back();
  return out;
}

// FPDF_GetMetadataText writes UTF-16LE bytes (2 per wchar). Convert to UTF-8.
static std::string utf16leToUtf8(const char* buf, unsigned long bytes) {
  if (bytes < sizeof(wchar_t)) return "";
  int wlen = static_cast<int>(bytes / sizeof(wchar_t));
  const wchar_t* wbuf = reinterpret_cast<const wchar_t*>(buf);
  while (wlen > 0 && wbuf[wlen - 1] == 0) --wlen;
  if (wlen == 0) return "";
  int needed = WideCharToMultiByte(CP_UTF8, 0, wbuf, wlen, nullptr, 0, nullptr, nullptr);
  if (needed <= 0) return "";
  std::string out(static_cast<size_t>(needed), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wbuf, wlen, out.data(), needed, nullptr, nullptr);
  return out;
}

// ---------------------------------------------------------------------------
// Filesystem helpers using wide paths so Chinese paths work everywhere.
// ---------------------------------------------------------------------------
static std::string baseNameNoExt(const std::string& utf8Path) {
  size_t slash = utf8Path.find_last_of("\\/");
  std::string fname = (slash == std::string::npos) ? utf8Path : utf8Path.substr(slash + 1);
  size_t dot = fname.find_last_of('.');
  if (dot != std::string::npos && dot > 0) fname = fname.substr(0, dot);
  return fname;
}

static void ensureParentDir(const std::wstring& wPath) {
  size_t slash = wPath.find_last_of(L"\\/");
  if (slash == std::wstring::npos) return;
  std::wstring parent = wPath.substr(0, slash);
  if (parent.empty()) return;
  // SHCreateDirectory recursively creates; returns ERROR_SUCCESS or ERROR_ALREADY_EXISTS.
  DWORD attr = GetFileAttributesW(parent.c_str());
  if (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY)) return;
  int rc = SHCreateDirectory(nullptr, parent.c_str());
  (void)rc;  // Best effort; failure surfaces later when CreateFileW fails.
}

static bool writeAllBytes(const std::wstring& wPath, const void* data, size_t len) {
  ensureParentDir(wPath);
  HANDLE h = CreateFileW(wPath.c_str(), GENERIC_WRITE, 0, nullptr,
                         CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (h == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  BOOL ok = WriteFile(h, data, static_cast<DWORD>(len), &written, nullptr);
  CloseHandle(h);
  return ok && written == static_cast<DWORD>(len);
}

// ---------------------------------------------------------------------------
// stb callback target - accumulates PNG bytes into a vector.
// ---------------------------------------------------------------------------
static void pngWriteCallback(void* ctx, void* data, int size) {
  auto* out = static_cast<std::vector<unsigned char>*>(ctx);
  auto* bytes = static_cast<const unsigned char*>(data);
  out->insert(out->end(), bytes, bytes + size);
}

// ---------------------------------------------------------------------------
// PDF metadata: title with graceful fallback.
// ---------------------------------------------------------------------------
static std::string getTitle(FPDF_DOCUMENT doc, const std::string& utf8Path) {
  unsigned long needed = FPDF_GetMetaText(doc, "Title", nullptr, 0);
  if (needed >= sizeof(wchar_t)) {
    std::vector<char> buf(needed);
    FPDF_GetMetaText(doc, "Title", buf.data(), needed);
    std::string t = utf16leToUtf8(buf.data(), needed);
    if (!t.empty()) return t;
  }
  return baseNameNoExt(utf8Path);
}

// ---------------------------------------------------------------------------
// Entry point - wmain so argv is wide and Unicode-safe.
// ---------------------------------------------------------------------------
int wmain(int argc, wchar_t* argv[]) {
  if (argc < 3) {
    fail("Usage: pdf_win <info|render> <pdf-path> [page-index scale output-path]");
  }

  const std::string command = wideToUtf8(argv[1]);
  const std::string pdfPath = wideToUtf8(argv[2]);

  DWORD attr = GetFileAttributesW(argv[2]);
  if (attr == INVALID_FILE_ATTRIBUTES || (attr & FILE_ATTRIBUTE_DIRECTORY)) {
    fail("PDF file does not exist: " + pdfPath);
  }

  FPDF_InitLibrary();

  FPDF_DOCUMENT doc = FPDF_LoadDocument(pdfPath.c_str(), nullptr);
  if (!doc) {
    unsigned long err = FPDF_GetLastError();
    FPDF_DestroyLibrary();
    fail("Unable to open PDF (code " + std::to_string(err) + "): " + pdfPath);
  }

  int pageCount = FPDF_GetPageCount(doc);
  if (pageCount < 0) pageCount = 0;

  if (command == "info") {
    std::string title = getTitle(doc, pdfPath);
    std::ostringstream os;
    os << "{\"success\":true,\"pageCount\":" << pageCount
       << ",\"title\":\"" << jsonEscape(title) << "\"}";
    emitJSON(os.str());
    FPDF_CloseDocument(doc);
    FPDF_DestroyLibrary();
    return 0;
  }

  if (command == "render") {
    if (argc < 6) {
      FPDF_CloseDocument(doc);
      FPDF_DestroyLibrary();
      fail("Usage: pdf_win render <pdf-path> <page-index> <scale> <output-path>");
    }

    int pageIndex = 0;
    double scale = 0.0;
    try {
      pageIndex = std::stoi(wideToUtf8(argv[3]));
      scale = std::stod(wideToUtf8(argv[4]));
    } catch (...) {
      FPDF_CloseDocument(doc);
      FPDF_DestroyLibrary();
      fail("Invalid page index or scale");
    }
    if (!(scale > 0.0)) {
      FPDF_CloseDocument(doc);
      FPDF_DestroyLibrary();
      fail("Invalid render scale");
    }
    std::string outputPath = wideToUtf8(argv[5]);

    if (pageIndex < 0 || pageIndex >= pageCount) {
      FPDF_CloseDocument(doc);
      FPDF_DestroyLibrary();
      fail("Page index out of range: " + std::to_string(pageIndex));
    }

    FPDF_PAGE page = FPDF_LoadPage(doc, pageIndex);
    if (!page) {
      FPDF_CloseDocument(doc);
      FPDF_DestroyLibrary();
      fail("Unable to load page: " + std::to_string(pageIndex));
    }

    // Page size in PDF points (1/72 inch). pdfium applies page rotation
    // automatically when rendering; we just need the post-rotation bounds.
    double pageW = FPDF_GetPageWidthF(page);
    double pageH = FPDF_GetPageHeightF(page);

    int imgW = static_cast<int>(std::ceil(pageW * scale));
    int imgH = static_cast<int>(std::ceil(pageH * scale));
    if (imgW < 1) imgW = 1;
    if (imgH < 1) imgH = 1;

    FPDF_BITMAP bitmap = FPDFBitmap_CreateEx(imgW, imgH, FPDFBitmap_BGRA, nullptr, 0);
    if (!bitmap) {
      FPDF_ClosePage(page);
      FPDF_CloseDocument(doc);
      FPDF_DestroyLibrary();
      fail("Unable to allocate bitmap");
    }

    // PDFs default to a transparent background; composite over white so the
    // resulting PNG looks the same as it does in PDFKit / Acrobat.
    FPDFBitmap_FillRect(bitmap, 0, 0, imgW, imgH, 0x00FFFFFF);

    FPDF_RenderPageBitmap(bitmap, page, 0, 0, imgW, imgH, 0, FPDF_ANNOT);

    void* rawBuf = FPDFBitmap_GetBuffer(bitmap);
    int stride = FPDFBitmap_GetStride(bitmap);
    if (!rawBuf || stride <= 0) {
      FPDFBitmap_Destroy(bitmap);
      FPDF_ClosePage(page);
      FPDF_CloseDocument(doc);
      FPDF_DestroyLibrary();
      fail("Unable to read bitmap buffer");
    }

    // pdfium outputs BGRA; stb wants RGBA. Copy + swap R/B per pixel.
    std::vector<unsigned char> rgba(static_cast<size_t>(stride) * imgH);
    std::memcpy(rgba.data(), rawBuf, rgba.size());
    for (int y = 0; y < imgH; ++y) {
      unsigned char* row = rgba.data() + static_cast<size_t>(y) * stride;
      for (int x = 0; x < imgW; ++x) {
        unsigned char* px = row + x * 4;
        std::swap(px[0], px[2]);  // B <-> R
      }
    }

    FPDFBitmap_Destroy(bitmap);
    FPDF_ClosePage(page);
    FPDF_CloseDocument(doc);
    FPDF_DestroyLibrary();

    std::vector<unsigned char> png;
    png.reserve(rgba.size() / 2);
    int writeOk = stbi_write_png_to_func(pngWriteCallback, &png, imgW, imgH, 4, rgba.data(), stride);
    if (!writeOk) {
      fail("Unable to encode PNG");
    }

    if (!writeAllBytes(argv[5], png.data(), png.size())) {
      fail("Unable to write rendered page: " + outputPath);
    }

    std::ostringstream os;
    os << "{\"success\":true,\"pageIndex\":" << pageIndex
       << ",\"width\":" << imgW
       << ",\"height\":" << imgH
       << ",\"outputPath\":\"" << jsonEscape(outputPath) << "\"}";
    emitJSON(os.str());
    return 0;
  }

  FPDF_CloseDocument(doc);
  FPDF_DestroyLibrary();
  fail("Unknown command: " + command);
}
