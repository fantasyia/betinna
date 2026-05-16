export const CAMPANHA_ENVIO_QUEUE = 'campanha-envio';

export interface CampanhaEnvioJobData {
  campanhaId: string;
  destinatarioId: string;
}
