import { SpecialSummonIntro } from './special-summon-intro.js?v=special-intro5';

const MADOKA_VOICE_CHUNKS = Object.freeze([
  './assets/audio/doppel/madoka-voice-0a.b64?v=madoka-doppel3',
  './assets/audio/doppel/madoka-voice-0b.b64?v=madoka-doppel3',
  './assets/audio/doppel/madoka-voice-1.b64?v=madoka-doppel3',
  './assets/audio/doppel/madoka-voice-2.b64?v=madoka-doppel3',
  './assets/audio/doppel/madoka-voice-3.b64?v=madoka-doppel3',
  './assets/audio/doppel/madoka-voice-4.b64?v=madoka-doppel3',
]);

let madokaVoiceSourcePromise = null;

function loadMadokaVoiceSource() {
  if (madokaVoiceSourcePromise) return madokaVoiceSourcePromise;
  madokaVoiceSourcePromise = Promise.all(
    MADOKA_VOICE_CHUNKS.map(async url => {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
      return (await response.text()).trim();
    }),
  ).then(parts => `data:audio/mpeg;base64,${parts.join('')}`);
  return madokaVoiceSourcePromise;
}

const originalWaitForVoice = SpecialSummonIntro.prototype._waitForVoice;

SpecialSummonIntro.prototype._waitForVoice = async function patchedWaitForVoice(characterId) {
  if (characterId === 'madoka' && this.voices?.madoka) {
    try {
      const audio = this.voices.madoka;
      const src = await loadMadokaVoiceSource();
      if (audio.src !== src) {
        audio.pause();
        audio.src = src;
        audio.load?.();
      }
    } catch (error) {
      console.warn('Failed to load replacement Madoka summon voice', error);
    }
  }
  return originalWaitForVoice.call(this, characterId);
};
