import { BrowserQRCodeReader } from '@zxing/browser';
import { useEffect, useRef, useState } from 'react';

import { refDesdeTexto } from '../../../src/dominio/identificadores';

type EstadoCamara = 'iniciando' | 'leyendo' | 'sin_permiso' | 'sin_camara' | 'error';

interface Props {
  activa: boolean;
  onLectura: (ref: string) => void;
}

/**
 * Lectura continua con la camara.
 *
 * No hay boton de "escanear": la camara queda leyendo y la usuaria pasa caja
 * tras caja. Con guantes, tocar la pantalla entre caja y caja no es viable.
 *
 * El anti-rebote es por contenido y no por tiempo: un QR sostenido frente a la
 * camara dispara muchas lecturas por segundo, pero cambiar de caja tiene que
 * responder al instante.
 */
export function Camara({ activa, onLectura }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const ultima = useRef<{ ref: string; cuando: number }>({ ref: '', cuando: 0 });
  const [estado, setEstado] = useState<EstadoCamara>('iniciando');

  // El callback se guarda en un ref para que cambiarlo no reinicie la camara:
  // reabrirla en cada render mostraria un parpadeo constante y perderia
  // lecturas justo mientras la usuaria esta pasando cajas.
  const alLeer = useRef(onLectura);
  alLeer.current = onLectura;

  useEffect(() => {
    if (!activa) return;

    let detener: (() => void) | undefined;
    let vivo = true;

    void (async () => {
      try {
        const lector = new BrowserQRCodeReader();
        const controles = await lector.decodeFromVideoDevice(
          undefined,
          video.current ?? undefined,
          (resultado) => {
            if (!resultado) return;
            const ref = refDesdeTexto(resultado.getText());
            if (!ref) return;

            const ahora = Date.now();
            const repetidoReciente =
              ref === ultima.current.ref && ahora - ultima.current.cuando < 2500;
            if (repetidoReciente) return;

            ultima.current = { ref, cuando: ahora };
            alLeer.current(ref);
          },
        );
        if (!vivo) {
          controles.stop();
          return;
        }
        detener = () => controles.stop();
        setEstado('leyendo');
      } catch (error) {
        const nombre = error instanceof Error ? error.name : '';
        if (nombre === 'NotAllowedError' || nombre === 'SecurityError') setEstado('sin_permiso');
        else if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError')
          setEstado('sin_camara');
        else setEstado('error');
      }
    })();

    return () => {
      vivo = false;
      detener?.();
    };
  }, [activa]);

  if (!activa) return null;

  if (estado === 'sin_permiso') {
    return (
      <div className="aviso aviso--error">
        <strong>La camara esta bloqueada</strong>
        <p>
          Hay que habilitarla desde el candado de la barra de direcciones, en Permisos, y despues
          recargar la pagina.
        </p>
        <p className="aviso__nota">
          Mientras tanto se puede seguir trabajando con el campo de codigo de arriba.
        </p>
      </div>
    );
  }

  if (estado === 'sin_camara') {
    return (
      <div className="aviso aviso--error">
        <strong>No se encontro ninguna camara</strong>
        <p>Se puede usar el campo de codigo o una pistola lectora USB.</p>
      </div>
    );
  }

  if (estado === 'error') {
    return (
      <div className="aviso aviso--error">
        <strong>No se pudo abrir la camara</strong>
        <p>
          La camara necesita HTTPS. Si estas en una direccion http, esa es la causa. Se puede
          seguir con el campo de codigo.
        </p>
      </div>
    );
  }

  return (
    <div className="camara">
      <video ref={video} className="camara__video" muted playsInline />
      <div className="camara__marco" aria-hidden="true" />
      {estado === 'iniciando' && <p className="camara__estado">Abriendo la camara...</p>}
    </div>
  );
}
