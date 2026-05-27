; ============================================================================
; Claude Code Studio — NSIS bootstrap installer macros
; ============================================================================
;
; Hooked into electron-builder via `nsis.include` in electron-builder.yml.
; Runs as part of the standard NSIS install flow:
;
;   1. electron-builder lays down the app files into $INSTDIR.
;   2. customInstall (below) runs: downloads Node 22 portable, verifies
;      its SHA256, extracts to $INSTDIR\resources\runtime\, then uses the
;      bundled npm to install @anthropic-ai/claude-code into that runtime
;      directory.
;   3. NSIS creates shortcuts and the app launches.
;   4. PtyManager (src/main/pty-manager.ts) prefers
;      $INSTDIR\resources\runtime\claude.cmd over system PATH.
;
; Implementation note: we use Windows-builtin tools only — no PowerShell.
; PowerShell.exe is sometimes blocked by Defender/AV during installer
; execution, which broke v2.0.0 on real users' machines. The alternatives
; ship with Windows 10 1803+ (April 2018) and are present on every
; supported Windows install:
;   - curl.exe          → downloads (TLS 1.2+ by default)
;   - tar.exe           → extracts .zip (libarchive-based, handles zip)
;   - certutil.exe      → SHA256 file hash
;   - cmd  (move/del)   → file system ops
;
; Failure behavior:
;   - Hard failures (network drop, SHA mismatch, extract fail) abort the
;     install AND embed the actual captured stderr in the user-facing
;     MessageBox so you don't need to hunt for the log file.
;   - Soft failures (CLI install fails but Node OK) install Studio anyway
;     and tell the user to install the CLI manually via the in-app
;     onboarding modal.
;
; Logging: every step DetailPrints to NSIS's install log, AND we append
; to $TEMP\ccs-install.log via a simple `>>` redirect for postmortem.
; ============================================================================

!define NODE_VERSION  "22.22.3"
!define NODE_ZIP      "node-v${NODE_VERSION}-win-x64.zip"
!define NODE_URL      "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}"
; SHA256 of node-v22.22.3-win-x64.zip from nodejs.org/dist/v22.22.3/SHASUMS256.txt
; (re-verify on each Node version bump).
!define NODE_SHA256   "6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33"

!define CLAUDE_PKG    "@anthropic-ai/claude-code"
!define INSTALL_LOG   "$TEMP\ccs-install.log"

; Ollama bootstrap (multi-model v3.0). Ollama is downloaded fresh from
; ollama.com — it is Authenticode-signed by Ollama, Inc., so Windows will
; verify the signature when the installer executes. We do not pin a SHA
; because Ollama releases new versions frequently and the URL serves the
; latest stable. If you want pinned versions, swap to a GitHub Releases
; pinned URL and add a SHA define below.
!define OLLAMA_URL    "https://ollama.com/download/OllamaSetup.exe"
!define OLLAMA_EXE    "OllamaSetup.exe"

; ----------------------------------------------------------------------------
; Helper: log to both NSIS detail view and $TEMP\ccs-install.log.
; Uses cmd /c echo + redirect — no PowerShell needed.
; Usage: !insertmacro CCSLog "message text"
; ----------------------------------------------------------------------------
!macro CCSLog msg
  DetailPrint "${msg}"
  nsExec::Exec 'cmd /c echo [%date% %time%] ${msg} >> "${INSTALL_LOG}"'
  Pop $R9
!macroend

; ----------------------------------------------------------------------------
; customInstall — the bootstrap.
;
; Runs after electron-builder copies the app files into $INSTDIR but
; before shortcuts are created. If we Abort, the whole install rolls back.
; ----------------------------------------------------------------------------
!macro customInstall
  !insertmacro CCSLog "===== Claude Code Studio bootstrap start ====="
  !insertmacro CCSLog "INSTDIR = $INSTDIR"

  ; --- Step 1: Download Node.js portable runtime via curl ---
  !insertmacro CCSLog "Downloading Node.js ${NODE_VERSION} (~30 MB)..."
  ; curl.exe ships with Windows 10 1803+. Less commonly blocked by
  ; Defender than PowerShell.
  ;   -L      follow redirects (nodejs.org may redirect to a CDN)
  ;   -f      fail with non-zero exit on HTTP 4xx/5xx
  ;   --show-error  print error on stderr (captured by nsExec)
  ;   -o      output file
  ;   --connect-timeout 30   per-connection cap
  ;   --max-time 300         total operation cap
  nsExec::ExecToStack 'curl.exe -L -f --show-error -o "$TEMP\${NODE_ZIP}" --connect-timeout 30 --max-time 300 "${NODE_URL}"'
  Pop $0
  Pop $1
  IntCmp $0 0 download_ok
    !insertmacro CCSLog "Node.js download FAILED (curl exit $0)"
    !insertmacro CCSLog "curl error: $1"
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Couldn't download the Node.js runtime.$\n$\ncurl exit code: $0$\n$\nError details (from curl):$\n$1$\n$\nIf the error mentions SSL/TLS, certificate, or proxy, your network may be intercepting HTTPS.$\nIf it mentions 'access denied' or similar, an antivirus may be blocking the download.$\n$\nFull log: ${INSTALL_LOG}"
    Abort
  download_ok:
  !insertmacro CCSLog "Node.js download OK"

  ; --- Step 2: Verify SHA256 via certutil ---
  !insertmacro CCSLog "Verifying Node.js download integrity (SHA256)..."
  ; certutil -hashfile prints the hex hash on its own line (no spaces
  ; between bytes in Win10+). We use `findstr` to look for the expected
  ; hash literal in the output — findstr exit code is 0 when found,
  ; non-zero when not. The hash is hex-only so it's safe to use as a
  ; literal pattern (no regex special chars).
  ;
  ; cmd /c "..." with embedded quoted path: cmd strips the outer pair
  ; and runs the contents as the command. The pipe is interpreted by
  ; cmd, not by nsExec.
  nsExec::ExecToStack 'cmd /c "certutil -hashfile "$TEMP\${NODE_ZIP}" SHA256 | findstr /i ${NODE_SHA256}"'
  Pop $0
  Pop $1
  IntCmp $0 0 sha_ok
    !insertmacro CCSLog "Node.js SHA256 MISMATCH (findstr exit $0)"
    !insertmacro CCSLog "expected: ${NODE_SHA256}"
    Delete "$TEMP\${NODE_ZIP}"
    MessageBox MB_ICONSTOP|MB_OK \
      "The Node.js download failed its integrity check.$\n$\nExpected SHA256: ${NODE_SHA256}$\n$\nThis usually means a corrupted download or that something on your network is tampering with HTTPS responses to nodejs.org.$\n$\nInstall aborted for safety. Full log: ${INSTALL_LOG}"
    Abort
  sha_ok:
  !insertmacro CCSLog "Node.js SHA256 OK"

  ; --- Step 3: Extract via tar.exe ---
  !insertmacro CCSLog "Extracting Node.js runtime..."
  CreateDirectory "$INSTDIR\resources\runtime"
  ; tar.exe in Windows 10 1803+ is libarchive-based and handles .zip
  ; transparently. -x extract, -f file, -C change directory.
  nsExec::ExecToStack 'tar.exe -x -f "$TEMP\${NODE_ZIP}" -C "$INSTDIR\resources\runtime"'
  Pop $0
  Pop $1
  IntCmp $0 0 extract_ok
    !insertmacro CCSLog "Extract FAILED (tar exit $0): $1"
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Couldn't extract the Node.js runtime.$\n$\ntar exit code: $0$\n$\nError:$\n$1$\n$\nUsually means antivirus quarantined the zip or your disk is full.$\n$\nFull log: ${INSTALL_LOG}"
    Abort
  extract_ok:

  ; Node's zip puts everything inside node-vX.Y.Z-win-x64/. Flatten so
  ; PtyManager's path resolution finds claude.cmd at runtime/ directly.
  ; Plain cmd: xcopy + rmdir.
  !insertmacro CCSLog "Flattening Node directory layout..."
  nsExec::ExecToStack 'cmd /c "if exist "$INSTDIR\resources\runtime\node-v${NODE_VERSION}-win-x64" (xcopy /E /Y /Q "$INSTDIR\resources\runtime\node-v${NODE_VERSION}-win-x64\*" "$INSTDIR\resources\runtime\" && rmdir /S /Q "$INSTDIR\resources\runtime\node-v${NODE_VERSION}-win-x64")"'
  Pop $0
  Pop $1

  Delete "$TEMP\${NODE_ZIP}"
  !insertmacro CCSLog "Node.js runtime ready"

  ; --- Step 4: Install Claude Code CLI via bundled npm ---
  !insertmacro CCSLog "Installing Claude Code CLI (${CLAUDE_PKG})..."
  ; Notes on flags:
  ; --loglevel=error — quiet on success, verbose stderr on failure.
  ; --ignore-scripts — skip pre/post-install lifecycle hooks. A
  ;   transitive dep of @anthropic-ai/claude-code has a postinstall
  ;   that requires node-gyp, but Node.js's portable Windows zip ships
  ;   npm WITHOUT the node-gyp/bin/node-gyp.js entry point that npm's
  ;   internal @npmcli/run-script tries to require. With --ignore-
  ;   scripts npm doesn't try to run any postinstall, so node-gyp is
  ;   never needed. Claude Code CLI itself is JS-only and works fine
  ;   without lifecycle scripts; transitive native builds that ARE
  ;   needed at runtime ship as prebuilds via node-gyp-build or
  ;   prebuild-install (those don't run as lifecycle scripts).
  nsExec::ExecToStack '"$INSTDIR\resources\runtime\node.exe" "$INSTDIR\resources\runtime\node_modules\npm\bin\npm-cli.js" install --prefix "$INSTDIR\resources\runtime" --registry=https://registry.npmjs.org/ --no-save --no-package-lock --no-audit --no-fund --ignore-scripts --loglevel=error ${CLAUDE_PKG}'
  Pop $0
  Pop $1
  IntCmp $0 0 npm_ok
    !insertmacro CCSLog "npm install FAILED (exit $0): $1"
    ; SOFT failure — Studio installs but no bundled CLI. The first-launch
    ; onboarding modal detects this via `claude doctor` and offers
    ; "Install Claude CLI" using the bundled Node.
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Claude Code Studio will install, but the Claude CLI couldn't be installed automatically.$\n$\nnpm exit code: $0$\nError: $1$\n$\nThe app's first-launch screen has an 'Install Claude CLI' button that retries this. Or install manually:$\nnpm install -g @anthropic-ai/claude-code$\n$\nFull log: ${INSTALL_LOG}"
    Goto bootstrap_done
  npm_ok:
  !insertmacro CCSLog "Claude Code CLI installed"

  ; --- Step 5: Detect or install Ollama (multi-model v3.0) ---
  ; Decision per user (2026-05-26): detect existing Ollama via well-known
  ; install paths + PATH probe. If found, log and skip. If not, curl down
  ; OllamaSetup.exe from ollama.com and run silently.
  !insertmacro CCSLog "Probing for Ollama..."

  ; First, check well-known install paths. We use 'where' for PATH probing
  ; and IfFileExists for the install dirs. Each check is independent.
  IfFileExists "$LOCALAPPDATA\Programs\Ollama\ollama.exe" ollama_found 0
  IfFileExists "$PROGRAMFILES\Ollama\ollama.exe" ollama_found 0
  IfFileExists "$PROGRAMFILES64\Ollama\ollama.exe" ollama_found 0
  ; PATH probe — `where.exe` exit 0 means found; 1 means not found.
  nsExec::ExecToStack 'where.exe ollama.exe'
  Pop $0
  Pop $1
  IntCmp $0 0 ollama_found ollama_not_found ollama_not_found

  ollama_found:
    !insertmacro CCSLog "Ollama already present — skipping install"
    Goto ollama_done

  ollama_not_found:
    !insertmacro CCSLog "Ollama not found. Downloading installer (~700 MB)..."
    ; Long max-time because the file is large and bandwidth varies.
    nsExec::ExecToStack 'curl.exe -L -f --show-error -o "$TEMP\${OLLAMA_EXE}" --connect-timeout 30 --max-time 1200 "${OLLAMA_URL}"'
    Pop $0
    Pop $1
    IntCmp $0 0 ollama_dl_ok
      !insertmacro CCSLog "Ollama download FAILED (curl exit $0): $1"
      ; SOFT failure — Studio installs anyway. User can install Ollama later
      ; from ollama.com and the Models panel will pick it up via probe.
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "Claude Code Studio will install, but the bundled Ollama download didn't complete.$\n$\ncurl exit code: $0$\n$1$\n$\nThe local-model catalog will be visible but you'll need to install Ollama from https://ollama.com/download before pulling any local models.$\n$\nFull log: ${INSTALL_LOG}"
      Goto ollama_done
    ollama_dl_ok:

    !insertmacro CCSLog "Running Ollama installer silently..."
    ; /verysilent + /norestart match Ollama's Inno Setup conventions.
    ; nsExec::ExecToStack waits for the installer to exit.
    nsExec::ExecToStack '"$TEMP\${OLLAMA_EXE}" /verysilent /norestart'
    Pop $0
    Pop $1
    IntCmp $0 0 ollama_install_ok
      !insertmacro CCSLog "Ollama installer FAILED (exit $0): $1"
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "Claude Code Studio will install, but Ollama's setup didn't complete cleanly.$\n$\nExit code: $0$\n$1$\n$\nYou can re-run Ollama Setup manually from $TEMP\${OLLAMA_EXE}, or download a fresh copy from https://ollama.com/download.$\n$\nFull log: ${INSTALL_LOG}"
      Goto ollama_done
    ollama_install_ok:
    !insertmacro CCSLog "Ollama installed"
    ; Clean up downloaded installer — Ollama's MSI/service is now persistent
    ; in the user's install dir, so the staging .exe is no longer needed.
    Delete "$TEMP\${OLLAMA_EXE}"

  ollama_done:

  bootstrap_done:
  !insertmacro CCSLog "===== Claude Code Studio bootstrap complete ====="
!macroend

; ----------------------------------------------------------------------------
; customUnInstall — clean up the bundled runtime.
;
; Without this, uninstall would orphan ~150 MB of node_modules in
; $INSTDIR\resources\runtime\.
; ----------------------------------------------------------------------------
!macro customUnInstall
  RMDir /r "$INSTDIR\resources\runtime"
!macroend
