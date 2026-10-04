package com.plugin.exora.passkeyCreationAndResult
import com.plugin.exora.PasskeyCreateArgs
import com.plugin.exora.base64Url
import com.plugin.exora.intArrayToByteArray
import org.json.JSONArray
import org.json.JSONObject



fun buildCreationJson(args: PasskeyCreateArgs): JSONObject {
      val rpId = args.rpId ?: throw IllegalArgumentException(
            "Missing rpId"
      )


      val rpName = args.rpName ?: throw IllegalArgumentException(
            "Missing rpName"
      )


      val userIdInts = args.userId ?: throw IllegalArgumentException(
            "Missing userId"
      )


      val userName = args.userName ?: throw IllegalArgumentException(
            "Missing userName"
      )


      val displayName = args.displayName ?: throw IllegalArgumentException(
            "Missing displayName"
      )


      val challengeInts = args.challenge ?: throw IllegalArgumentException(
            "Missing challenge"
      )

      val algorithms = args.algorithms ?: throw IllegalArgumentException(
            "Missing algorithms"
      )

      val prfSaltInts = args.prfSalt ?: throw IllegalArgumentException(
            "Missing PRF salt"
      )


      val residentKey = args.residentKey

      if (residentKey != "required") {
            throw IllegalArgumentException(
                  "residentKey must be required"
            )
      }


      val userVerification =
            args.userVerification

      if (userVerification != "required") {
            throw IllegalArgumentException(
                  "userVerification must be required"
            )
      }


      val attestation = args.attestation ?: throw IllegalArgumentException(
            "Missing attestation"
      )


      if (prfSaltInts.size != 32) {
            throw IllegalArgumentException(
                  "PRF salt must be exactly 32 bytes"
            )
      }

      val userIdBytes =
            intArrayToByteArray(
                  userIdInts,
                  "userId"
            )


      val challengeBytes =
            intArrayToByteArray(
                  challengeInts,
                  "challenge"
            )


      val prfSaltBytes =
            intArrayToByteArray(
                  prfSaltInts,
                  "prfSalt"
            )


      val rpJson = JSONObject()

      rpJson.apply {
            put("id", rpId)
            put("name", rpName)
      }

      val userJson = JSONObject()

      userJson.apply {
            put("id", base64Url(userIdBytes))
            put("name", userName)
            put("displayName", displayName)
      }

      val pubKeyCredParams = JSONArray()

      for (algorithmsIndex in algorithms.indices){
            val algorithmValue = algorithms[algorithmsIndex]
            val algorithmJson = JSONObject()

            algorithmJson.apply {
                  put("type", "public-key")
                  put("alg", algorithmValue)
            }

            pubKeyCredParams.put(algorithmJson)
      }

      val authenticatorSelection = JSONObject()

      authenticatorSelection.apply {
            put("requireResidentKey", true)
            put("residentKey", residentKey)
            put("userVerification", userVerification)
      }

      val prfEval = JSONObject()

      prfEval.put("first", base64Url(prfSaltBytes))


      val prf = JSONObject()

      prf.put("eval", prfEval)


      val extensions = JSONObject()

      extensions.put("prf", prf)

      val requestJson = JSONObject()

      requestJson.apply {
            put("challenge", base64Url(challengeBytes))
            put("rp", rpJson)
            put("user", userJson)
            put("pubKeyCredParams", pubKeyCredParams)
            put("authenticatorSelection", authenticatorSelection)
            put("attestation", attestation)
            put("extensions", extensions)
      }

      val timeout = args.timeout

      if (timeout == null) {
            requestJson.put("timeout", timeout)
      }

      return requestJson
}
