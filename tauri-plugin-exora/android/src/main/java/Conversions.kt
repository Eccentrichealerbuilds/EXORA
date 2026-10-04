package com.plugin.exora

import android.util.Base64
import org.json.JSONArray

fun intArrayToByteArray(values: IntArray, fieldName: String): ByteArray {
      if (values.isEmpty()) {
            throw IllegalArgumentException(
                  "$fieldName cannot be empty"
            )
      }
      val bytes = ByteArray(values.size)
      for (index in values.indices) {
            val value = values[index]

            if (value < 0 || value > 255) {
                  throw IllegalArgumentException(
                        "$fieldName contains an invalid byte at index $index"
                  )
            }
            bytes[index] = value.toByte()
      }
      return bytes
}

fun base64Url(bytes: ByteArray) : String{
      val flags = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
      return Base64.encodeToString(
            bytes,
            flags
      )
}

fun base64UrlToJsonArray(value: String): JSONArray {
      if (value.isEmpty()) {
            throw IllegalArgumentException("Base64URL value cannot be empty")
      }

      val flags = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING

      val bytes = Base64.decode(value, flags)
      val numbers = JSONArray()

      for (index in bytes.indices) {
            val signedByte = bytes[index]
            val unSignedValue = signedByte.toInt() and 0xff

            numbers.put(unSignedValue)
      }
      return numbers
}