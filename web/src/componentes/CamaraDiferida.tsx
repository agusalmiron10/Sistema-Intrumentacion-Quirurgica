import { Component, lazy, Suspense, type ReactNode } from 'react';

/**
 * El lector de QR (@zxing) pesa unas 20 veces mas que el resto de la app.
 * Cargarlo aparte permite que la pantalla de escaneo aparezca enseguida y que
 * el campo de codigo manual —que es el fallback de primera clase— se pueda
 * usar sin esperar a que baje la libreria.
 *
 * En una tablet con la señal del subsuelo del hospital, esa diferencia es la
 * que decide si el sistema se usa o se abandona.
 */
const Camara = lazy(async () => ({ default: (await import('./Camara')).Camara }));

interface Props {
  activa: boolean;
  onLectura: (ref: string) => void;
}

/**
 * Si la carga del lector falla, la pantalla de escaneo tiene que seguir
 * sirviendo. Pasa en dos situaciones concretas: sin señal la primera vez que
 * se abre esta pantalla, y despues de desplegar una version nueva mientras
 * alguien tenia la app abierta (el chunk viejo ya no existe).
 *
 * En los dos casos la respuesta correcta es la misma: avisar y seguir con el
 * campo de codigo, no dejar la pantalla rota.
 */
class LimiteDeError extends Component<{ children: ReactNode }, { fallo: boolean }> {
  override state = { fallo: false };

  static getDerivedStateFromError(): { fallo: boolean } {
    return { fallo: true };
  }

  override render(): ReactNode {
    if (this.state.fallo) {
      return (
        <div className="aviso aviso--atencion">
          <strong>No se pudo cargar el lector de QR</strong>
          <p>
            Se puede seguir con el campo de codigo de arriba o con una pistola lectora. Si hay
            señal, recargar la pagina lo vuelve a intentar.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function CamaraDiferida(props: Props) {
  if (!props.activa) return null;

  return (
    <LimiteDeError>
      <Suspense
        fallback={
          <div className="camara camara--cargando">
            <p className="camara__estado">Cargando el lector...</p>
          </div>
        }
      >
        <Camara {...props} />
      </Suspense>
    </LimiteDeError>
  );
}
