import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ptBR from '@/i18n/pt-BR.json';
import enUS from '@/i18n/en-US.json';

/**
 * i18n — internacionalização do frontend.
 *
 * Default: pt-BR (mercado-alvo). Inglês como fallback técnico.
 * Detecta idioma do navegador automaticamente (querystring → localStorage → navigator).
 *
 * Uso em componentes:
 *   const { t } = useTranslation();
 *   <h1>{t('dashboard.title')}</h1>
 *
 * Trocar idioma:
 *   i18n.changeLanguage('en-US');
 *
 * Adicionar novo idioma:
 *   1. Criar `src/i18n/<locale>.json` com mesmas chaves de `pt-BR.json`
 *   2. Importar e registrar no `resources` abaixo
 *
 * Hoje carregamos tudo síncrono (bundles pequenos). Quando volume crescer,
 * migrar pra carga lazy via `i18next-http-backend`.
 */

export const FALLBACK_LNG = 'pt-BR';
export const SUPPORTED_LNGS = ['pt-BR', 'en-US'] as const;
export type SupportedLng = (typeof SUPPORTED_LNGS)[number];

export function initI18n(): void {
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        'pt-BR': { translation: ptBR },
        'en-US': { translation: enUS },
      },
      fallbackLng: FALLBACK_LNG,
      supportedLngs: SUPPORTED_LNGS as unknown as string[],
      interpolation: {
        // React já escapa por default — desnecessário no i18next
        escapeValue: false,
      },
      detection: {
        order: ['querystring', 'localStorage', 'navigator'],
        lookupQuerystring: 'lng',
        lookupLocalStorage: 'i18nextLng',
        caches: ['localStorage'],
      },
    });
}

export default i18n;
