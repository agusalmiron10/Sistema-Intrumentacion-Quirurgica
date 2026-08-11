import { useEffect, useRef, useState } from 'react';

import { refDesdeTexto } from '../../../src/dominio/identificadores';

interface Props {
  onIngreso: (ref: string) => void;
}

/**
 * Campo de codigo, siempre visible.
 *
 * No es un modo alternativo escondido detras de un boton: las etiquetas se
 * rayan, se mojan y se despegan, y cuando eso pasa este campo es la unica
 * forma de trabajar. Por eso esta siempre a la vista y con el foco puesto.
 *
 * El mismo campo recibe lo que manda una pistola lectora USB, que se comporta
 * como un teclado y termina la lectura con Enter. De ahi el foco automatico:
 * sin foco, la pistola escribe en la nada.
 */
export function EntradaManual({ onIngreso }: Props) {
  const campo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState('');

  // Se recupera el foco cuando se toca cualquier parte que no sea un control:
  // alcanza con un toque perdido en la pantalla para que la pistola deje de
  // funcionar, y eso es invisible para quien la esta usando.
  useEffect(() => {
    const recuperarFoco = (evento: Event): void => {
      const destino = evento.target as HTMLElement | null;
      if (destino?.closest('button, input, select, textarea, a')) return;
      campo.current?.focus();
    };
    document.addEventListener('click', recuperarFoco);
    campo.current?.focus();
    return () => document.removeEventListener('click', recuperarFoco);
  }, []);

  const enviar = (): void => {
    const ref = refDesdeTexto(texto);
    if (!ref) return;
    onIngreso(ref);
    setTexto('');
    campo.current?.focus();
  };

  return (
    <form
      className="entrada-manual"
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
    >
      <label className="entrada-manual__etiqueta" htmlFor="codigo-caja">
        Codigo de la caja
      </label>
      <div className="entrada-manual__fila">
        <input
          id="codigo-caja"
          ref={campo}
          className="entrada-manual__campo"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="LAP-02"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="done"
          inputMode="text"
        />
        <button type="submit" className="boton boton--primario" disabled={texto.trim() === ''}>
          Agregar
        </button>
      </div>
    </form>
  );
}
