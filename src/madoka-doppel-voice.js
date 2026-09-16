import { SpecialSummonIntro } from './special-summon-intro.js?v=special-intro6';

const MADOKA_DOPPEL_SRC = './assets/audio/doppel/madoka.mp3?v=doppel5';

const originalWaitForVoice = SpecialSummonIntro.prototype._waitForVoice;

SpecialSummonIntro.prototype._waitForVoice = function patchedWaitForVoice(characterId) {
  if (characterId === 'madoka' && this.voices?.madoka) {
    const audio = this.voices.madoka;
    if (!String(audio.src || '').includes('doppel5')) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = MADOKA_DOPPEL_SRC;
      audio.load?.();
    }
  }
  return originalWaitForVoice.call(this, characterId);
};
