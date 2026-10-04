package com.plugin.exora.credentialGetBuildAndParse

import com.plugin.exora.base64UrlToJsonArray
import org.json.JSONObject

fun parseGetCredentialResult(authenticationResponseJson: String): JSONObject {
      val androidResponse = JSONObject(authenticationResponseJson)

      val credentialType = androidResponse.getString("type")

      if (credentialType != "public-key") {
            throw IllegalArgumentException("Expected a public-key credential")
      }

      var credentialIdText = androidResponse.optString("rawId")

      if (credentialIdText.isEmpty()) {
            credentialIdText = androidResponse.getString("id")
      }

      val credentialId = base64UrlToJsonArray(credentialIdText)

      val result = JSONObject()

      result.put("credentialId", credentialId)

      val extensionResults = androidResponse.optJSONObject("clientExtensionResults")

      if (extensionResults != null) {
            val prf = extensionResults.optJSONObject("prf")

            if (prf != null) {
                  val prfResults = prf.optJSONObject("results")

                  if (prfResults != null && prfResults.has("first")) {
                        val outputText = prfResults.getString("first")

                        val prfOutput = base64UrlToJsonArray(outputText)

                        if (prfOutput.length() != 32) {
                              throw IllegalArgumentException("PRF output must be exactly 32 bytes")
                        }

                        result.put("prfOutput", prfOutput)
                  }
            }
      }
      return result
}