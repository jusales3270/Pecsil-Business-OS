// Tipos mínimos do d3-force-3d (as forças de posição usadas na cena 3D do Segundo Cérebro).
declare module "d3-force-3d" {
  type Forca = { strength(s: number): Forca };
  export function forceX(x?: number): Forca;
  export function forceY(y?: number): Forca;
  export function forceZ(z?: number): Forca;
}
