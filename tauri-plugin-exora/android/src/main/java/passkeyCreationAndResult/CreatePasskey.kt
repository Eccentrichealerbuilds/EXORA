package com.plugin.exora.PasskeyCreationAndResult

import android.annotation.SuppressLint
import android.app.Activity
import android.os.CancellationSignal
import android.util.Log

import androidx.core.content.ContextCompat

import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.exceptions.CreateCredentialException
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import com.plugin.exora.PasskeyCreateArgs
import com.plugin.exora.passkeyCreationAndResult.buildCreationJson
import com.plugin.exora.passkeyCreationAndResult.parseCreationResult


@SuppressLint("PublicKeyCredential", "CredManMutableContext")
fun createPasskey(invoke: Invoke, pluginActivity: Activity, credentialManager: CredentialManager) {
      try {


            val args = invoke.parseArgs(PasskeyCreateArgs::class.java)

            val creationJson = buildCreationJson(args)

            val requestJson = creationJson.toString()

            val createRequest = CreatePublicKeyCredentialRequest(requestJson)
            val cancellationSignal = CancellationSignal()

            val executor = ContextCompat.getMainExecutor(pluginActivity)

            val callback = object :
                  CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {

                  override fun onResult(result: CreateCredentialResponse) {


                        if (result is CreatePublicKeyCredentialResponse) {

                              try {
                                    val parsedResult = parseCreationResult(result.registrationResponseJson)
                                    val prfEnabled = parsedResult.optBoolean("prfEnabled", false)
                                    val prfOutput = parsedResult.optJSONArray("prfOutput")
                                    var prfByteCount = 0
                                    if (prfOutput != null) {
                                          prfByteCount = prfOutput.length()
                                    }
                                    Log.i(
                                          "PasskeyBridge",
                                          "Create complete: " +
                                                  "prfEnabled=$prfEnabled, " +
                                                  "prfBytes=$prfByteCount"
                                    )

                                    val response = JSObject(parsedResult.toString())
                                    invoke.resolve(response)
                              }catch (e: Exception) {
                                    Log.e(
                                          "PasskeyBridge",
                                          "Could not parse passkey response",
                                          e
                                    )

                                    invoke.reject("Invalid passkey response: ${e.message}")

                              }
                        } else {
                              invoke.reject(
                                    "Expected a public-key credential response"
                              )
                        }
                  }

                  override fun onError(e: CreateCredentialException) {
                        Log.e(
                              "PasskeyBridge",
                              "Passkey creation failed: ${e.type} ${e.message}"
                        )

                        invoke.reject(
                              "Passkey creation failed: ${e.message}"
                        )
                  }
            }

            credentialManager.createCredentialAsync(
                  pluginActivity,
                  createRequest,
                  cancellationSignal,
                  executor,
                  callback
            )
      }catch (e: Exception) {
            Log.e(
                  "PasskeyBridge",
                  "Could not start passkey creation",
                  e
            )

            invoke.reject(
                  "Could not start passkey creation: ${e.message}"
            )
      }
}