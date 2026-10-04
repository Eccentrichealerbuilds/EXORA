package com.plugin.exora.credentialGetBuildAndParse

import android.annotation.SuppressLint
import android.app.Activity
import android.os.CancellationSignal
import android.util.Log
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialException
import app.tauri.plugin.Invoke
import com.plugin.exora.PasskeyGetArgs
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import app.tauri.plugin.JSObject


@SuppressLint("CredManMutableContext")
fun getCredential(invoke: Invoke, pluginActivity: Activity, credentialManager: CredentialManager) {
      try {
            val args = invoke.parseArgs(PasskeyGetArgs::class.java)
            val requestJson = buildGetCredentialJson(args)

            Log.i("PasskeyBridge", "Starting existing passkey selection")

            val publicKeyOption = GetPublicKeyCredentialOption(requestJson.toString())

            val options = listOf(publicKeyOption)

            val getRequest = GetCredentialRequest(options)

            val cancellationSignal = CancellationSignal()

            val executor = ContextCompat.getMainExecutor(pluginActivity)

            val callback = object:
                  CredentialManagerCallback<GetCredentialResponse, GetCredentialException>{
                  override fun onResult(result: GetCredentialResponse) {
                        val credential = result.credential

                        if (credential is PublicKeyCredential) {
                              try {
                                    val parsed = parseGetCredentialResult(
                                          credential.authenticationResponseJson
                                    )

                                    val prfOutput = parsed.optJSONArray("prfOutput")

                                    var prfByteCount = 0
                                     if (prfOutput != null){
                                           prfByteCount = prfOutput.length()
                                     }
                                    Log.i("PasskeyBridge", "Get complete: prfBytes=$prfByteCount")

                                    invoke.resolve(JSObject(parsed.toString()))
                              } catch (e: Exception) {
                                    invoke.reject("Invalid passkey response: ${e.message}")
                              }
                        } else{
                              invoke.reject("Expected a public-key credential")
                        }
                  }

                  override fun onError(e: GetCredentialException) {
                        Log.e("PasskeyBridge", "Passkey selection failed: ${e.type} ${e.message}")
                        invoke.reject("Passkey selection failed: ${e.message}")
                  }
            }
            credentialManager.getCredentialAsync(
                  pluginActivity, getRequest, cancellationSignal,
                  executor, callback
            )
      }catch (error: Exception) {
            Log.e(
                  "PasskeyBridge", "Could not start passkey selection",
                  error
            )

            invoke.reject("Could not start passkey selection: ${error.message}")
      }
}