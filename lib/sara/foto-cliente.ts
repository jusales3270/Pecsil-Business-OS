/**
 * Foto pronta para enviar à SARA: reduzida no aparelho (lado maior 1568 px, JPEG). Não fica no aparelho; na
 * plataforma, só na SARA que guarda evidência (Qualidade). Usada pelo painel da SARA e pela janela de registro.
 */
export type Foto = { tipo: "image/jpeg"; dados: string; previa: string };

export async function reduzirFoto(arquivo: File): Promise<Foto> {
  const img = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1568 / Math.max(img.width, img.height));
  const tela = document.createElement("canvas");
  tela.width = Math.round(img.width * escala); tela.height = Math.round(img.height * escala);
  tela.getContext("2d")?.drawImage(img, 0, 0, tela.width, tela.height);
  img.close();
  const previa = tela.toDataURL("image/jpeg", 0.82);
  return { tipo: "image/jpeg", dados: previa.split(",")[1] ?? "", previa };
}
