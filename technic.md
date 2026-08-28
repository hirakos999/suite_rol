# Architettura tecnica — Suite modulare (stile Aira Compact, tema Acid/Berlin/Pixel)

## 1. Stack tecnologico

| Layer | Scelta | Perché |
|---|---|---|
| Dev server | Node.js + Express | Coerente col tuo setup esistente, utile anche come proxy per TTS locale |
| Build | Vite + TypeScript | Hot reload veloce, tree-shaking, integrazione diretta con Capacitor |
| Audio core | Web Audio API nativo | Nessuna scorciatoia: serve controllo fine per DSP custom |
| Scheduling | Tone.js (solo Transport/Scheduling) | Risolve il problema del timing preciso senza reinventarlo |
| DSP custom | AudioWorklet | Per vocoder, filtro diodo (303), motore granulare — roba che gira nel thread audio, non sul main thread |
| Cavi/patch | SVG overlay (non canvas) | Serve hit-testing facile per singolo cavo (click per staccare) |
| UI moduli | Canvas o sprite PNG con `image-rendering: pixelated` | Per il look pixel-art vero, non "finto retro" |
| State | EventEmitter centrale / Zustand se usi un framework | Preact > React per peso su mobile, se serve un framework |
| Packaging mobile | Capacitor | Vedi nota §8 |

## 2. Architettura audio-core

- **Un solo `AudioContext`** condiviso, istanziato al primo gesture utente (obbligo dei browser).
- **MasterClock**: modulo a sé stante con scheduler look-ahead (pattern "A Tale of Two Clocks" — `setInterval` di controllo + scheduling preciso su `audioContext.currentTime`). Ha un proprio jack "clock out". Gli altri moduli si sincronizzano **solo se collegati via cavo**, non in automatico — replica il comportamento hardware reale dove il sync è opzionale.
- **Ogni modulo = classe TS autonoma** con:
  - proprio grafo Web Audio interno (source → processing → GainNode di uscita)
  - jack di I/O tipizzati: `audio`, `cv`, `clock`, `midi`
  - stato serializzabile in JSON (per salvare/caricare patch)
  - metodi `connect(targetModule, targetJack)` / `disconnect()`

## 3. Patch bay — i cavi "fisici"

Questa è la parte più delicata, dettaglio implementativo:

- Layer SVG assoluto sopra la griglia moduli. `pointer-events: none` di default sul layer, `pointer-events: auto` solo su jack e cavi.
- Ogni jack = `<circle>` con attributi `data-module`, `data-jack`, `data-type`. Colore anello = tipo segnale:
  - verde = audio
  - magenta = CV/mod
  - ambra = clock
  - ciano = MIDI
- **Drag-to-connect**: `pointerdown` su un jack → genera `<path>` bezier che segue il puntatore. `pointerup` su un jack compatibile (stesso `data-type`, o `audio`↔`cv` se vuoi permettere modulazione incrociata) → crea connessione.
- **Curva del cavo**: quadratic bezier con punto di controllo spostato verso il basso in proporzione alla distanza, tipo `controlY = midY + distance * 0.15`, per simulare il peso/sag di un cavo vero.
- **Stato centrale**: `PatchGraph = { edges: [{ from, to, type }] }`. Ogni edge visivo ha una connessione Web Audio reale creata/distrutta in parallelo — mai solo visiva.
- **Multi-output**: un jack `out` può avere N cavi collegati (come modulare vero). Un jack `in` di norma 1 cavo; se serve sommare più sorgenti, somma automatica su un `GainNode` nascosto.
- **Salvataggio patch**: JSON con stato moduli + edges. `localStorage` + export/import come file `.patch.json`.

## 4. Direzione estetica

**Palette** (deliberatamente lontana dai pastelli Roland):

| Ruolo | Colore |
|---|---|
| Sfondo | `#1a1a1a` / `#232323` (cemento scuro) |
| Pannello modulo | `#2e2e2e` con leggero dithering/rumore pixel |
| Accento primario | `#c6ff00` — verde acido |
| Accento secondario | `#ff00c8` — magenta UV |
| Accento clock/avviso | `#ffb000` — ambra |
| Testo/LED | font bitmap monospace (es. "Press Start 2P" o bitmap 5x7 custom stile display LCD) |

**Inspo visive:**
- Interni Berghain/Tresor — cemento grezzo, buio, un solo colore che spacca la scena
- Flyer acid house fine '80/inizio '90 — smiley deformati, fluo su nero
- Display Elektron (Octatrack/Digitakt) — OLED monocromatico, griglia step pixel-perfect
- LSDJ (Little Sound DJ, Game Boy) — estetica tracker verde-grigio, usata anche in live set noise/techno
- Terminal/teletext CRT — scanline leggere, glow sui LED, glitch occasionale sui readout
- Estetica hacker DIY — etichette scritte a mano/gaffer tape, viti a vista, finish grezzo non lucido

**Componenti pixel-art da disegnare:** knob rotativo (sprite a step, niente rotazione fluida), step-sequencer con LED quadrati, VU meter a barre pixel, jack con anello che pulsa quando attivo.

## 5. Specifiche moduli

Nota: rinomina i moduli per evitare naming Roland diretto se poi pubblichi l'app (T-8/S-1/J-6/P-6/E-4 sono nomi commerciali Roland).

### RHYTHM/ACID UNIT (equiv. T-8)
- 6 tracce drum **sintetizzate** via Web Audio, non sample pack (pulito lato IP, leggero lato peso app): kick (sine + pitch envelope + click transient), snare (noise+tono), hat chiusa/aperta (noise filtrato HP + envelope), clap (noise multi-burst), tom/perc.
- Bassline acid monofonica: oscillatore saw/square → filtro LP risonante (BiquadFilter, o AudioWorklet custom che emula un filtro a scaletta a diodi per un carattere 303 più vero) → envelope su cutoff (env mod knob), accent (boost velocity + filter mod extra), slide (portamento tra step).
- Sequencer 16/32/64 step, per-step: nota, accent, slide, gate length.
- Jack: clock in/out, audio out (bus drum + bass separati), CV out (bass envelope per modulare altri moduli).
- **Riuso**: la logica sequencer del tuo eurorack rack esistente è probabilmente riadattabile qui quasi 1:1.

### TWEAK SYNTH (equiv. S-1)
- 2 oscillatori (waveform base + disegno custom waveform via canvas → `PeriodicWave`) + sub-oscillatore.
- Filtro LP/HP/BP commutabile, risonanza, ADSR dedicato.
- Sequencer 64 step: velocity, gate length, probability per-step, "motion recording" (registra automazioni manopole in tempo reale su lane separate).
- Arpeggiatore, riser (sweep automatico filtro+pitch su trigger).
- Jack: audio out, CV in (modulazione filtro esterna), clock in.
- **Riuso**: il tuo bass synth esistente è la base naturale da estendere.

### CHORD ENGINE (equiv. J-6)
- Motore poly 4-6 voci, oscillatori detuned per pad caldo.
- Sequencer accordi: griglia di slot (8-16), ogni slot = accordo (root + tipo + voicing), selezione via piano-roll semplificato o ruota accordi.
- Knob "morph voicing" per alterare inversione/spread in tempo reale.
- Strum mode (arpeggia invece di suonare in blocco).
- Jack: audio out, clock in.
- **Riuso**: hai già un chord synth nel progetto esistente, questo è principalmente un restyling + sequencer dedicato.

### SAMPLE DECK (equiv. P-6)
- Estendi il tuo sampler MPC-style esistente con modalità granulare (AudioWorklet o `Tone.GrainPlayer`): grain size, posizione, scatter pitch, densità.
- Auto-chop via transient detection (soglia energia semplice sul buffer).
- 6-8 pad x banchi multipli, sequencer per trigger melodico dei chop.
- Jack: audio out, clock in (sync chop a tempo), audio in (per campionare altri moduli in catena).

### VOICE LAB (equiv. E-4 — il modulo nuovo, tue richieste specifiche)

Tre sorgenti voce selezionabili, tutte confluiscono nella stessa catena effetti:

1. **Generatore vocale testuale (TTS)** — digiti parole, non serve parlare tu.
   - Consigliato: **Piper** TTS locale (ONNX, veloce, buona qualità), esposto come endpoint sul tuo Express esistente — coerente col tuo setup AI locale (Ollama ecc.). Il server genera un WAV, il client lo carica in un `AudioBufferSourceNode`.
   - Alternativa zero-setup: `SpeechSynthesis` Web API nativa — gratis ma voce dipendente da OS/browser, meno controllabile stilisticamente.
   - Su mobile (Capacitor): fallback a TTS nativo piattaforma (Android `TextToSpeech`, iOS `AVSpeechSynthesizer`) via plugin, dietro la stessa interfaccia comune così la catena effetti non cambia in base alla piattaforma.

2. **Modulo registrazione voce**
   - `getUserMedia` + `MediaRecorder`, oppure cattura diretta in `AudioBuffer` via AudioWorklet per bassa latenza.
   - Buffer riutilizzabile come loop o one-shot nella stessa catena.

3. **Modulo import file esterno**
   - Input file / drag-drop → `AudioContext.decodeAudioData()` → buffer pronto per la catena.

**Catena effetti condivisa** (dopo il selettore sorgente):
- Vocoder: banco filtri bandpass (8-16 bande) analisi/risintesi, portante = oscillatore interno o segnale esterno via jack CV/audio in. Da fare in AudioWorklet per performance.
- Pitch/harmonizer: pitch-shift (parti da `Tone.PitchShift`, poi eventualmente worklet custom per qualità migliore).
- Glitch/stutter: loop di micro-slice del buffer con retrigger random-quantizzato.
- Looper multi-layer con overdub e undo.

- Jack: audio in (voce esterna da altri moduli), audio out, CV in (es. usare la Tweak Synth come carrier del vocoder — collegamento diretto tra moduli via cavo).

## 6. Struttura cartelle progetto

```
music-suite/
├── server/
│   ├── index.js
│   └── tts/
│       └── piper-proxy.js
├── src/
│   ├── core/
│   │   ├── AudioEngine.ts        # AudioContext singleton, master clock
│   │   ├── PatchGraph.ts         # stato connessioni, connect/disconnect
│   │   └── ModuleBase.ts         # classe base astratta per ogni modulo
│   ├── modules/
│   │   ├── rhythm-acid/
│   │   │   ├── RhythmAcidModule.ts
│   │   │   ├── voices/           # kick.ts, snare.ts, hat.ts, bass303.ts
│   │   │   └── ui/
│   │   ├── tweak-synth/
│   │   ├── chord-engine/
│   │   ├── sample-deck/
│   │   └── voice-lab/
│   │       ├── VoiceLabModule.ts
│   │       ├── sources/          # tts.ts, recorder.ts, fileImport.ts
│   │       └── fx/               # vocoder.worklet.ts, pitchShift.ts, glitch.ts, looper.ts
│   ├── ui/
│   │   ├── PatchBay.ts           # rendering cavi SVG + drag logic
│   │   ├── theme/                # palette colori, font pixel, sprite knob
│   │   └── components/
│   ├── worklets/                 # AudioWorkletProcessor files
│   └── main.ts
├── public/assets/sprites/
├── capacitor.config.ts
├── vite.config.ts
└── package.json
```

## 7. Ordine di build consigliato

1. Core: `AudioEngine` + `MasterClock` + `PatchGraph` — senza questo nessun modulo comunica.
2. `PatchBay` UI (cavi), anche con moduli placeholder — valida subito l'interazione visiva più rischiosa.
3. Rhythm/Acid Unit (riusa sequencer eurorack esistente).
4. Tweak Synth (riusa bass synth esistente).
5. Sample Deck (estende sampler MPC esistente).
6. Chord Engine (restyling del chord synth esistente).
7. Voice Lab — il più nuovo/complesso, meglio quando core + patch bay sono stabili.
8. Tema pixel-art finale su tutti i moduli — più veloce farlo quando il sistema di componenti è già fermo.

## 8. Nota porting mobile

- **Capacitor** preferito a Cordova: community più attiva, plugin moderni, supporto migliore per Web Audio/AudioWorklet.
- **Web MIDI assente su iOS WKWebView** — se ti serve sync col TD-3-SR da mobile, servirà un plugin nativo CoreMIDI più avanti, o il sync esterno resta desktop/Android-only nel primo rilascio.
- **Microfono**: `getUserMedia` richiede gestione permessi nativa via plugin Capacitor oltre al permesso browser.
- **AudioWorklet**: supportato su WebView moderne (Android Chromium, iOS WKWebView 14.5+) — verifica il target minimo SDK che ti serve.