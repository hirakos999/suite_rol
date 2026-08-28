#!/bin/bash
#
# SUITE ROL — launcher for macOS.
#
# Double-click this file in Finder. It installs what is needed the first time,
# starts the local server and opens the rack in your browser.
#
# Doppio click su questo file dal Finder. La prima volta installa quello che
# serve, poi avvia il server locale e apre il rack nel browser.

set -u

PORT=3333
URL="http://localhost:${PORT}"

# Always work from the folder this script lives in, whatever the current
# directory is and however many spaces the path contains.
cd "$(dirname "$0")" || exit 1

# --- pretty output ----------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'
  YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; RED=""; YELLOW=""; RESET=""
fi

say_both() { printf '%s\n%s\n' "$1" "${DIM}$2${RESET}"; }

[ -t 1 ] && clear
printf '%s\n' "${GREEN}${BOLD}"
printf '   ███ SUITE ROL ███\n'
printf '%s\n\n' "${RESET}"

# --- 1. is Node installed? --------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n\n' "${RED}${BOLD}Manca Node.js / Node.js is missing${RESET}"
  say_both "SUITE ROL ha bisogno di Node.js per funzionare. È gratis." \
           "SUITE ROL needs Node.js to run. It is free."
  printf '\n'
  say_both "Ti apro la pagina: scarica il pulsante grande a sinistra (LTS)," \
           "Opening the download page: take the big left-hand button (LTS),"
  say_both "installa, poi torna qui e fai di nuovo doppio click su questo file." \
           "install it, then come back and double-click this file again."
  printf '\n'
  read -r -n 1 -p "$(printf '%s' "${BOLD}Premi un tasto per aprire la pagina / Press any key${RESET}")" _ || true
  printf '\n'
  open "https://nodejs.org/it/download"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  printf '%s\n\n' "${RED}${BOLD}Node.js troppo vecchio / Node.js too old${RESET}"
  say_both "Hai la versione $(node -v). Serve la 18 o superiore." \
           "You have $(node -v). Version 18 or newer is required."
  printf '\n'
  open "https://nodejs.org/it/download"
  exit 1
fi

printf '%s %s\n' "${GREEN}✓${RESET}" "Node.js $(node -v)"

# --- 2. is something already on the port? -----------------------------------

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  printf '%s %s\n\n' "${YELLOW}!${RESET}" "$(say_both \
    "SUITE ROL sembra già avviata: apro solo il browser." \
    "SUITE ROL looks like it is already running: just opening the browser.")"
  open "$URL"
  exit 0
fi

# --- 3. first-run install ---------------------------------------------------

if [ ! -d node_modules ]; then
  printf '\n%s\n' "${BOLD}Prima installazione / First-time setup${RESET}"
  say_both "Un minuto circa, solo questa volta. Serve internet." \
           "About a minute, only this once. Needs an internet connection."
  printf '\n'

  if ! npm install --no-audit --no-fund; then
    printf '\n%s\n' "${RED}${BOLD}Installazione fallita / Install failed${RESET}"
    say_both "Controlla la connessione a internet e riprova." \
             "Check your internet connection and try again."
    printf '\n'
    read -r -n 1 -p "Premi un tasto per chiudere / Press any key to close" _ || true
    exit 1
  fi
  printf '\n%s %s\n' "${GREEN}✓${RESET} " "Installazione completata / Setup complete"
fi

# --- 4. start the server ----------------------------------------------------

printf '\n%s\n' "${BOLD}Avvio / Starting…${RESET}"

node server/index.js &
SERVER_PID=$!

# Stop the server when this window is closed or Ctrl+C is pressed.
cleanup() {
  printf '\n%s\n' "${DIM}Chiusura / Shutting down…${RESET}"
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM HUP

# Wait for the port to actually accept connections before opening the browser,
# otherwise the page loads before the server is up and shows an error.
for _ in $(seq 1 40); do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  printf '\n%s\n' "${RED}${BOLD}Il server non è partito / The server failed to start${RESET}"
  read -r -n 1 -p "Premi un tasto per chiudere / Press any key to close" _ || true
  exit 1
fi

open "$URL"

printf '\n'
printf '%s\n' "${GREEN}${BOLD}  SUITE ROL è aperta nel browser${RESET}"
printf '%s\n\n' "${DIM}  SUITE ROL is open in your browser${RESET}"
printf '%s\n' "  ${BOLD}${URL}${RESET}"
printf '\n'
printf '%s\n' "  Clicca ${BOLD}POWER ON${RESET} nella pagina per far partire l'audio."
printf '%s\n' "  ${DIM}Click POWER ON in the page to start the audio.${RESET}"
printf '\n'
printf '%s\n' "  ${YELLOW}Per fermare tutto: chiudi questa finestra.${RESET}"
printf '%s\n' "  ${DIM}To stop everything: close this window.${RESET}"
printf '\n'

# Keep the script alive so the server keeps running.
wait "$SERVER_PID"
