package com.plugin.exora

import app.tauri.annotation.InvokeArg


@InvokeArg
class PasskeyCreateArgs {
      var rpId: String? = null
      var rpName: String? =null
      var userId: IntArray? =null
      var userName: String? = null
      var displayName: String? = null
      var challenge: IntArray? = null
      var algorithms: IntArray? =null
      var prfSalt: IntArray? = null
      var residentKey: String? =null
      var userVerification: String? =null
      var attestation: String? =null
      var timeout: Long? =null
}

@InvokeArg
class PasskeyGetArgs{
      var rpId: String? = null
      var challenge: IntArray? = null
      var credentialId: IntArray? = null
      var transports: Array<String>? = null
      var prfSalt: IntArray? = null
      var userVerification: String? = null
      var timeout: Long? = null
}