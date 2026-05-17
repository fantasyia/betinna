import { useTranslation } from 'react-i18next';
import { Select } from '@/components/FormField';
import { SUPPORTED_LNGS, type SupportedLng } from '@/lib/i18n';

const LABELS: Record<SupportedLng, string> = {
  'pt-BR': '🇧🇷 Português (Brasil)',
  'en-US': '🇺🇸 English (US)',
};

/**
 * Dropdown pra trocar idioma da interface. Persistido em localStorage
 * (chave `i18nextLng` gerenciada pelo i18next-browser-languagedetector).
 *
 * Plug onde fizer sentido (Profile, Configurações).
 */
export function LanguageSelect() {
  const { i18n } = useTranslation();
  return (
    <Select
      value={i18n.language}
      onChange={(e) => {
        void i18n.changeLanguage(e.target.value);
      }}
      data-testid="language-select"
      aria-label="Idioma da interface"
    >
      {SUPPORTED_LNGS.map((lng) => (
        <option key={lng} value={lng}>
          {LABELS[lng]}
        </option>
      ))}
    </Select>
  );
}
