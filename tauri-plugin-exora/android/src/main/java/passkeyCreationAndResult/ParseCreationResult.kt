package com.plugin.exora.passkeyCreationAndResult

import android.util.Log
import com.plugin.exora.base64UrlToJsonArray
import org.json.JSONObject

fun parseCreationResult(registrationResponseJson: String): JSONObject {

      val androidResponse = JSONObject(registrationResponseJson)
      val credentialType = androidResponse.getString("type")

      if (credentialType != "public-key") {
            throw IllegalArgumentException(
                  "Expected a public-key credential"
            )
      }

      var credentialIdText = androidResponse.optString("rawId")

      if (credentialIdText.isEmpty()) {
            credentialIdText = androidResponse.getString("id")
      }

      val credentialId = base64UrlToJsonArray(credentialIdText)

      val result = JSONObject()

      result.put("credentialId", credentialId)

      val extensionResults = androidResponse.optJSONObject("clientExtensionResults")
      var prfObject: JSONObject? = null

      if (extensionResults != null) {
            prfObject = extensionResults.optJSONObject("prf")
      }

      var prfEnabled = false

      if (prfObject != null) {
            prfEnabled = prfObject.optBoolean("enabled", false)
      }

      result.put("prfEnabled", prfEnabled)

      val responseObject = androidResponse.optJSONObject("response")

      if (responseObject != null) {
            val transports = responseObject.optJSONArray("transports")

            if (transports != null) {
                  result.put("transports", transports)
            }
      }

      if (prfObject != null) {
            val prfResults = prfObject.optJSONObject("results")

            if (prfResults != null) {
                  if (prfResults.has("first")) {
                        val prfOutputText = prfResults.getString("first")

                        val prfOutput = base64UrlToJsonArray(prfOutputText)

                        if (prfOutput.length() != 32) {
                              throw IllegalArgumentException("PRF output must be exactly 32 bytes")
                        }

                        result.put("prfOutput", prfOutput)
                  }
            }
      }
      return result
}