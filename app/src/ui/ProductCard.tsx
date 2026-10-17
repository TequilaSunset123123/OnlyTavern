import type { SponsoredProduct } from '../api'

// A Brand Deal's product (2026-10-17): in the deal's popup, and as the link under the #ad
// it puts up. Pictures are app/src/assets/products/<image>.webp, named in events.json
// rare.brandDeal.products.
const files = import.meta.glob<string>('../assets/products/*.webp', { eager: true, import: 'default' })
const PICTURES: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]))

export function ProductCard({ product }: { product: SponsoredProduct }) {
  const src = PICTURES[product.image]
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-primary bg-surface-primary p-2.5">
      {src && <img src={src} alt="" className="size-16 shrink-0 rounded-lg bg-white object-cover" />}
      <div className="min-w-0">
        <p className="text-[11px] tracking-wider text-content-tertiary">SPONSORED PRODUCT</p>
        <p className="typography-body-default-16px-semibold break-words">{product.name}</p>
      </div>
    </div>
  )
}
