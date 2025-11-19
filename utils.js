// utils.js

/**
 * Extrai menções de IDs de canais/cargos de uma string.
 * @param {string} input 
 * @returns {string[]}
 */
export function parseMentions(input) {
  if (!input) return [];
  // Procura por IDs de 17 a 19 dígitos
  return input.match(/\d{17,19}/g) || [];
}

/**
 * Função para esperar por um tempo.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}