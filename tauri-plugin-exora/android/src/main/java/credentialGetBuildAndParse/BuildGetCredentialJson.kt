package com.plugin.exora.credentialGetBuildAndParse

import com.plugin.exora.PasskeyGetArgs
import com.plugin.exora.base64Url
import com.plugin.exora.intArrayToByteArray
import org.json.JSONArray
import org.json.JSONObject

fun buildGetCredentialJson(args: PasskeyGetArgs): JSONObject {
      val rpId = args.rpId ?: throw IllegalArgumentException("Missing rpId")

      val challengeInts = args.challenge ?: throw IllegalArgumentException("Missing challenge")

      val prfSaltInts = args.prfSalt ?: throw IllegalArgumentException("Missing PRF salt")

      if (prfSaltInts.size != 32) {
            throw IllegalArgumentException("PRF salt must be exactly 32 bytes")
      }

      val userVerification =
            args.userVerification

      if (userVerification != "required") {
            throw IllegalArgumentException("User verification must be required")
      }

      val challengeBytes = intArrayToByteArray(
                  challengeInts, "challenge"
      )

      val prfSaltBytes = intArrayToByteArray(
                  prfSaltInts, "prfSalt"
      )

      val prfEval = JSONObject()

      prfEval.put("first", base64Url(prfSaltBytes))

      val prf = JSONObject()

      prf.put("eval", prfEval)

      val extensions = JSONObject()

      extensions.put("prf", prf)

      val requestJson = JSONObject()

      requestJson.apply {
            put("rpId", rpId)
            put("challenge", base64Url(challengeBytes))
            put("userVerification", "required")
            put("extensions", extensions)
      }

      val credentialIdInts = args.credentialId

      if (credentialIdInts != null) {
            val credentialIdBytes= intArrayToByteArray(credentialIdInts, "CredentialId")
            val credential = JSONObject()

            credential.apply {
                  put("type", "public-key")
                  put("id", base64Url(credentialIdBytes))
            }

            val transports = args.transports
            if (transports != null) {
                  val transportsJson = JSONArray()
                  for (index in transports.indices) {
                        transportsJson.put( transports[index])
                  }
                  credential.put("transports", transportsJson)
            }

            val allowCredentials = JSONArray()
            allowCredentials.put(credential)

            requestJson.put("allowCredentials", allowCredentials)
      }

      val timeout = args.timeout

      if (timeout != null) {
            requestJson.put("timeout", timeout)
      }

      return requestJson
}