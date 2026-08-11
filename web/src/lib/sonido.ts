/**
 * Respuesta sonora del escaneo.
 *
 * En modo continuo la usuaria no mira la pantalla: pasa caja tras caja. El
 * sonido es la unica confirmacion que llega. Tres tonos distintos y bien
 * separados para poder distinguirlos sin mirar.
 */

let contexto: AudioContext | null = null;

/** El navegador exige un gesto del usuario para poder sonar. */
export function habilitarSonido(): void {
  contexto ??= new AudioContext();
  if (contexto.state === 'suspended') void contexto.resume();
}

function tono(frecuencia: number, duracionMs: number, retrasoMs = 0): void {
  if (!contexto) return;
  const inicio = contexto.currentTime + retrasoMs / 1000;
  const oscilador = contexto.createOscillator();
  const volumen = contexto.createGain();

  oscilador.frequency.value = frecuencia;
  oscilador.type = 'sine';
  volumen.gain.setValueAtTime(0.0001, inicio);
  volumen.gain.exponentialRampToValueAtTime(0.3, inicio + 0.01);
  volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + duracionMs / 1000);

  oscilador.connect(volumen).connect(contexto.destination);
  oscilador.start(inicio);
  oscilador.stop(inicio + duracionMs / 1000 + 0.02);
}

/** Escaneo aceptado: un pitido corto y agudo. */
export function sonarOk(): void {
  tono(880, 90);
}

/** Rechazado por la maquina de estados: dos tonos graves. */
export function sonarError(): void {
  tono(220, 140);
  tono(180, 200, 160);
}

/** Ya estaba escaneada en esta tanda: tono medio, para no confundir con un alta. */
export function sonarRepetido(): void {
  tono(520, 80);
}
