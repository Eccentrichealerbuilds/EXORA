export function uint8ArrayToNumberArray(bytes: Uint8Array): number[] {
      const numbers: number[] = []
      for (let index = 0; index < bytes.length; index++) {
            numbers.push(bytes[index])
      }
      return numbers
}

export function numberArrayToUint8Array(numbers: number[], fieldName: String): Uint8Array {

      if (numbers.length === 0 || !Array.isArray(numbers)) {
            throw new Error("INVALID ARRAY OR LENGTH")
      }
      const bytes = new Uint8Array(numbers.length)
      for (let index = 0; index < numbers.length; index++) {
            const value = numbers[index]

            if (!Number.isInteger(value)) {
                  throw new Error(
                        `${fieldName} contains a non-integer`
                  );
            }

            if (
                  value < 0 ||
                  value > 255
            ) {
                  throw new Error(
                        `${fieldName} contains an invalid byte`
                  );
            }

            bytes[index] = value;
      }
      return bytes
}
