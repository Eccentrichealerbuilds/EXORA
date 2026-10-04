export function formatBalance(value: string, maxDecimals = 4) {
      const [whole, fraction = ""] = value.split(".");
      const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const shownFraction = fraction.slice(0, maxDecimals).replace(/0+$/, "");
      if (whole === "0" && !shownFraction && /[1-9]/.test(fraction.slice(maxDecimals))) {
            return `<0.${"0".repeat(Math.max(maxDecimals - 1, 0))}1`;
      }
      return shownFraction ? `${groupedWhole}.${shownFraction}` : groupedWhole;
}
