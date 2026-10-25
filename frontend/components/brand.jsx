export function BrandMark({ inverse = false }) {
  return (
    <img
      className="brand-icon"
      src={inverse ? '/brand/shopflow-mark-light.svg' : '/brand/shopflow-mark.svg'}
      width={38}
      height={38}
      alt=""
      aria-hidden="true"
    />
  );
}
export function BrandName() {
  return (
    <span className="brand-name">
      <span>Shop</span>
      <span>Flow</span>
    </span>
  );
}
