'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { META_PRICE_BRL, formatBRL } from '@/lib/whatsapp/meta-pricing';

/**
 * Static reference table for Meta's per-message WhatsApp pricing
 * (Brazil, 2026 per-message model). Reachable from the Disparos list
 * before the user starts a broadcast — the personalized estimate
 * (category x reach) lives separately on the wizard's last step.
 */
export function MetaPricingDialog() {
  const t = useTranslations('Broadcasts.page.metaPricing');
  const [open, setOpen] = useState(false);

  const rows: {
    key: 'service' | 'utility' | 'authentication' | 'marketing';
    price: string;
  }[] = [
    { key: 'service', price: t('free') },
    { key: 'utility', price: formatRange('Utility') },
    { key: 'authentication', price: formatRange('Authentication') },
    { key: 'marketing', price: formatRange('Marketing') },
  ];

  function formatRange(category: keyof typeof META_PRICE_BRL) {
    const [min, max] = META_PRICE_BRL[category];
    return `${formatBRL(min)} – ${formatBRL(max)}`;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-muted" />
        }
      >
        <Coins className="h-4 w-4" />
        {t('buttonLabel')}
      </DialogTrigger>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('dialogTitle')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('dialogSubtitle')}
          </DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">{t('colCategory')}</TableHead>
              <TableHead className="text-muted-foreground">{t('colPrice')}</TableHead>
              <TableHead className="hidden text-muted-foreground sm:table-cell">
                {t('colWhen')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} className="border-border hover:bg-transparent">
                <TableCell className="font-medium text-foreground">
                  {t(`categories.${row.key}.label`)}
                </TableCell>
                <TableCell
                  className={
                    row.key === 'service'
                      ? 'font-medium text-primary'
                      : 'font-medium text-foreground'
                  }
                >
                  {row.price}
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {t(`categories.${row.key}.desc`)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </DialogContent>
    </Dialog>
  );
}
