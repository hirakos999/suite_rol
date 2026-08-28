// In-app manual. The rack has enough hidden behaviour (attenuverters, jack
// types, the pattern bank) that a "?" panel is not optional.

import { el } from '../utils.js';

const SECTIONS = [
  {
    title: 'CAVI E JACK',
    body: [
      ['Collegare', 'Trascina da un jack a un altro. I jack compatibili pulsano, quelli incompatibili si spengono.'],
      ['Scollegare', 'Tasto destro su un jack: stacca tutti i suoi cavi. I cavi non si cliccano — passano sopra i pannelli e ruberebbero i click ai controlli.'],
      ['Vedere dove va', 'Passa il mouse su un jack: i suoi cavi si illuminano. Il tasto CABLES in alto li nasconde tutti.'],
      ['Verde AUDIO', 'Il suono vero e proprio. Da un OUT a un IN.'],
      ['Magenta CV', 'Tensione di controllo: non si sente, muove un parametro (di solito il cutoff).'],
      ['Ambra CLOCK', 'Il sync. Un modulo suona a tempo SOLO se ha un cavo clock. Senza, resta fermo.'],
      ['Ciano MIDI', 'Predisposto, non ancora usato.']
    ]
  },
  {
    title: 'SE COLLEGO IL DRUM A UN ALTRO STRUMENTO?',
    body: [
      ['Dipende dal jack di ARRIVO', 'Il cavo non "manda lo strumento dentro l\'altro". Porta il suo segnale a un ingresso preciso, e quello che succede lo decide l\'ingresso, non l\'uscita.'],
      ['→ IN di ASPRILLA', 'Il suono entra nel sampler. THRU si apre da solo così lo senti, e RESAMPLE registra proprio quello: è così che trasformi un pattern di kick in un sample.'],
      ['→ CUTOFF / BRIGHT (magenta)', 'La batteria NON si sente in quel modulo: la sua forma d\'onda muove il filtro. Ogni cassa apre e chiude il cutoff — il classico pompaggio. Ricorda: alza DEPTH, a zero non succede niente.'],
      ['→ CARRIER di ZOLA', 'La batteria diventa la portante del vocoder: la voce prende il timbro della batteria invece del sintetizzatore interno.'],
      ['→ VOICE di ZOLA', 'Il contrario: la batteria diventa il modulatore, e la portante viene sagomata a ritmo. Suono metallico e ritmico.'],
      ['E intanto?', 'Il modulo continua a suonare normalmente nel master, perché MIX è acceso. Spegni MIX se vuoi che il suono vada SOLO nella destinazione.'],
      ['Più cavi insieme', 'Una uscita può andare in più ingressi contemporaneamente. Un ingresso somma automaticamente tutto quello che gli arriva.']
    ]
  },
  {
    title: 'CUTOFF, DEPTH, MIX',
    body: [
      ['CUTOFF', 'La frequenza sopra la quale il filtro taglia. Abbassalo e il suono si scurisce; alzalo e torna brillante. Con RESO alta il filtro fischia attorno a quel punto: è il suono acid.'],
      ['ENV / ENV MOD', 'Quanto l\'inviluppo apre il cutoff a ogni nota. A zero il filtro sta fermo, alto e ogni nota fa "wow".'],
      ['DEPTH', 'La manopolina sotto ogni jack CV. È un attenuverter e parte da ZERO: finché non la alzi, il cavo CV collegato non fa niente. A destra modula in positivo, a sinistra inverte. Serve così — un segnale audio a piena scala sul cutoff lo manderebbe sotto zero Hz e il modulo ammutolirebbe.'],
      ['MIX', 'Sotto ogni jack OUT. Acceso (default) il modulo continua a suonare nel master anche se lo hai collegato altrove. Spegnilo se vuoi che il suono vada SOLO dove l\'hai patchato.']
    ]
  },
  {
    title: 'PATTERN E SONG (KANCHELSKIS)',
    body: [
      ['Uno slot = tutto il rack', 'Gli slot A–H non salvano un solo strumento: fotografano i pattern di tutti e cinque i moduli insieme.'],
      ['Salvare', 'Clicca uno slot per selezionarlo, poi premi SAVE. Il click da solo non salva mai.'],
      ['Richiamare', 'Clicca uno slot già pieno (bordo colorato): il rack intero ci salta dentro.'],
      ['Cancellare', 'Tasto destro su uno slot.'],
      ['SONG', '+ ADD accoda lo slot selezionato alla sequenza. Il numero accanto a ogni voce sono le battute che quella parte dura. Premi SONG per farla partire: i cambi avvengono solo a fine battuta.'],
      ['PATTERN BARS', 'Quante battute dura un pattern prima che la song avanzi.']
    ]
  },
  {
    title: 'CAMPIONARE GLI STRUMENTI (ASPRILLA)',
    body: [
      ['Senza cavi', 'Premi RESAMPLE: registra dal master per le battute scelte, cioè tutto quello che stai sentendo, e lo affetta sui pad.'],
      ['Un solo strumento', 'Collega l\'uscita del modulo (es. YEBOAH DRUM) all\'IN di ASPRILLA, poi RESAMPLE: registra solo quello. THRU si apre da solo così lo senti mentre entra.'],
      ['KIT / CHOP', 'KIT suona i suoni sintetizzati interni, disponibili subito. CHOP suona le fette del sample caricato o ricampionato.'],
      ['AUTO CHOP / GRID CHOP', 'Auto taglia sui transienti; Grid taglia in 8 fette uguali — meglio per un loop già a tempo.']
    ]
  },
  {
    title: 'LA VOCE (ZOLA)',
    body: [
      ['Cosa fa il vocoder', 'Prende una voce (il modulatore) e la usa per sagomare un suono sintetico (la portante). Senza voce in ingresso non esce niente: è normale, non è rotto.'],
      ['VOWEL SYNTH', 'La sorgente interna, sempre disponibile. Non pronuncia parole: canta vocali (A/E/I/O/U). Tasto destro su uno step per cambiare la vocale.'],
      ['Parlare davvero', 'Scrivi nel campo e premi SPEAK. Su macOS il server usa la voce di sistema (say): funziona senza installare niente e passa nel vocoder. Scegli voce e velocità qui accanto.'],
      ['Voci', 'Il menu VOICE elenca le voci di sistema raggruppate per lingua, italiane in cima. RATE è la velocità in parole al minuto — rallentala molto per un effetto robotico.'],
      ['Piper (opzionale)', 'Per voci neurali migliori si può installare Piper e avviare il server con PIPER_MODEL: se c\'è viene usato al posto di say. Vedi il README.'],
      ['LIVE MIC', 'La via più diretta per capire il vocoder: parla nel microfono e senti la portante prendere la forma della tua voce.'],
      ['BYPASS', 'Salta il vocoder e manda la sorgente diretta in uscita.']
    ]
  },
  {
    title: 'ALTRO',
    body: [
      ['Spazio', 'Play / stop.'],
      ['Tasto destro su uno step', 'Cambia la nota (righe melodiche) o la velocity (percussioni).'],
      ['LEN OF / STEPS', 'Su YEBOAH: lunghezza per singola traccia (16/32/64). Tracce di lunghezza diversa si sfasano fra loro.'],
      ['REC', 'Registra il master in WAV: LIVE fino a stop, BARS a battute, SECS a secondi.'],
      ['CLEAR', 'Azzera pattern, cavi e slot salvati. Chiede conferma una volta.']
    ]
  }
];

export function createHelp() {
  const panel = el('div', { class: 'help', id: 'help' },
    el('div', { class: 'help-inner' },
      el('div', { class: 'help-head' },
        el('h2', {}, 'COME SI USA'),
        el('button', { class: 'btn btn-ghost help-close' }, 'CHIUDI ✕')
      ),
      el('div', { class: 'help-body' },
        ...SECTIONS.map((sec) =>
          el('section', { class: 'help-section' },
            el('h3', {}, sec.title),
            el('dl', {},
              ...sec.body.flatMap(([term, desc]) => [
                el('dt', {}, term),
                el('dd', {}, desc)
              ])
            )
          )
        )
      )
    )
  );

  const close = () => panel.classList.remove('is-open');
  panel.querySelector('.help-close').addEventListener('click', close);
  panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === '?' && !e.target.matches('input, textarea, select')) {
      panel.classList.toggle('is-open');
    }
  });

  return {
    el: panel,
    toggle: () => panel.classList.toggle('is-open'),
    open: () => panel.classList.add('is-open')
  };
}
