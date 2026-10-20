'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/** Old `/settings?tab=whatsapp` links: the connection moved to /connection. */
export function RedirectToConnection() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/connection');
  }, [router]);
  return (
    <div className="flex justify-center py-12 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}
