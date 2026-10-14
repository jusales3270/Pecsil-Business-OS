import { toast } from 'sonner';
import { useStore } from '@/store';
import { ComprasDiretas } from '../../../../app/components/compras-diretas';

/**
 * Compras diretas no Compras: as mesmas OCs (mesmo número) que o Almoxarifado vê.
 * Daqui sai a compra direta pedida pela diretoria e o PDF da OC para o fornecedor.
 */
export default function DiretasPage() {
  const caps = useStore((state) => state.caps);
  const fetchInitialData = useStore((state) => state.fetchInitialData);
  return (
    <ComprasDiretas
      eyebrow="COMPRAS · SEM COTAÇÃO"
      texto="Compras autorizadas sem cotação. Cada uma nasce aprovada como OC: a que veio pela nota já chega preenchida pelo Almoxarifado."
      podeRegistrar={caps.cotar || caps.comprar}
      podeAbrirOC
      notify={(mensagem) => { toast.success(mensagem); void fetchInitialData(); }}
    />
  );
}
