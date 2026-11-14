import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Badge — chip pequeno pra status, contagens, channel labels.
 *
 * Variantes semânticas: neutral, primary, success, danger, warning, info.
 * Channels (WA/IG/FB/EM/ML/Shopee/Amazon/TikTok) usam <ChannelBadge>.
 *
 * Tamanhos: sm (compacto pra tabelas), md (padrão).
 */
const badgeVariants = cva(
  [
    'inline-flex items-center gap-1',
    'rounded-full font-semibold tracking-tight whitespace-nowrap',
    'border',
  ],
  {
    variants: {
      variant: {
        neutral: 'bg-surface-hover text-text-subtle border-border',
        primary: 'bg-primary/15 text-primary border-primary/25',
        success: 'bg-success/15 text-success border-success/25',
        danger: 'bg-danger/15 text-danger border-danger/25',
        warning: 'bg-warning/15 text-warning border-warning/25',
        info: 'bg-info/15 text-info border-info/25',
        outline: 'bg-transparent text-text-subtle border-border-strong',
      },
      size: {
        sm: 'h-4 px-1.5 text-[10px] leading-none',
        md: 'h-[18px] px-2 text-[11px]',
        lg: 'h-5 px-2.5 text-xs',
      },
    },
    defaultVariants: {
      variant: 'neutral',
      size: 'md',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, size, children, ...props },
  ref,
) {
  return (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {children}
    </span>
  );
});

// ─── ChannelBadge — etiqueta colorida por canal ───────────────────

const CHANNEL_CLASSES: Record<
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'FACEBOOK_COMENTARIO'
  | 'INSTAGRAM_COMENTARIO'
  | 'EMAIL'
  | 'MARKETPLACE_ML'
  | 'MARKETPLACE_SHOPEE'
  | 'MARKETPLACE_AMAZON'
  | 'MARKETPLACE_TIKTOK'
  | 'MARKETPLACE_SHEIN',
  string
> = {
  WHATSAPP: 'bg-channel-whatsapp/15 text-channel-whatsapp border-channel-whatsapp/30',
  INSTAGRAM: 'bg-channel-instagram/15 text-channel-instagram border-channel-instagram/30',
  FACEBOOK: 'bg-channel-facebook/15 text-channel-facebook border-channel-facebook/30',
  // Comentário: mesma cor do canal, contorno tracejado pra não confundir com DM.
  FACEBOOK_COMENTARIO:
    'bg-channel-facebook/10 text-channel-facebook border-dashed border-channel-facebook/40',
  INSTAGRAM_COMENTARIO:
    'bg-channel-instagram/10 text-channel-instagram border-dashed border-channel-instagram/40',
  EMAIL: 'bg-channel-email/15 text-channel-email border-channel-email/30',
  MARKETPLACE_ML: 'bg-channel-ml/15 text-channel-ml border-channel-ml/30',
  MARKETPLACE_SHOPEE: 'bg-channel-shopee/15 text-channel-shopee border-channel-shopee/30',
  MARKETPLACE_AMAZON: 'bg-channel-amazon/15 text-channel-amazon border-channel-amazon/30',
  MARKETPLACE_TIKTOK: 'bg-channel-tiktok/15 text-channel-tiktok border-channel-tiktok/30',
  // Shein sem token de canal próprio: neutro (a marca é preto e branco).
  MARKETPLACE_SHEIN: 'bg-surface-hover text-text border-border',
};

const CHANNEL_LABEL: Record<keyof typeof CHANNEL_CLASSES, string> = {
  WHATSAPP: 'WA',
  INSTAGRAM: 'IG',
  FACEBOOK: 'FB',
  FACEBOOK_COMENTARIO: 'FB 💬',
  INSTAGRAM_COMENTARIO: 'IG 💬',
  EMAIL: 'EM',
  MARKETPLACE_ML: 'ML',
  MARKETPLACE_SHOPEE: 'SHP',
  MARKETPLACE_AMAZON: 'AMZ',
  MARKETPLACE_TIKTOK: 'TT',
  MARKETPLACE_SHEIN: 'SHN',
};

export function ChannelBadge({
  canal,
  size = 'md',
  fullLabel,
  className,
}: {
  canal: keyof typeof CHANNEL_CLASSES;
  size?: 'sm' | 'md' | 'lg';
  /** Se true mostra "WhatsApp" em vez de "WA". */
  fullLabel?: boolean;
  className?: string;
}) {
  const LABEL_FULL: Record<keyof typeof CHANNEL_CLASSES, string> = {
    WHATSAPP: 'WhatsApp',
    INSTAGRAM: 'Instagram',
    FACEBOOK: 'Facebook',
    FACEBOOK_COMENTARIO: 'Comentário FB',
    INSTAGRAM_COMENTARIO: 'Comentário IG',
    EMAIL: 'E-mail',
    MARKETPLACE_ML: 'Mercado Livre',
    MARKETPLACE_SHOPEE: 'Shopee',
    MARKETPLACE_AMAZON: 'Amazon',
    MARKETPLACE_TIKTOK: 'TikTok',
    MARKETPLACE_SHEIN: 'Shein',
  };
  return (
    <Badge
      size={size}
      variant="outline"
      className={cn(CHANNEL_CLASSES[canal], 'uppercase tracking-wide', className)}
    >
      {fullLabel ? LABEL_FULL[canal] : CHANNEL_LABEL[canal]}
    </Badge>
  );
}

export { badgeVariants };
