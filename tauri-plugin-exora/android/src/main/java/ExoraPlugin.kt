package com.plugin.exora

import androidx.credentials.CredentialManager
import android.app.Activity
import android.content.pm.ActivityInfo
import app.tauri.annotation.InvokeArg
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import com.plugin.exora.PasskeyCreationAndResult.createPasskey
import com.plugin.exora.credentialGetBuildAndParse.getCredential
@InvokeArg
class ChartFullscreenArgs { var enabled: Boolean = false }

@TauriPlugin
class ExoraPlugin (private val pluginActivity: Activity): Plugin(pluginActivity) {
      private var previousOrientation: Int? = null
      private var previousBarBehavior: Int? = null
      private var statusWasVisible = true
      private var navigationWasVisible = true

      @Command
      fun setChartFullscreen(invoke: Invoke) {
            val enabled = invoke.parseArgs(ChartFullscreenArgs::class.java).enabled
            pluginActivity.runOnUiThread {
                  try {
                        val window = pluginActivity.window
                        val controller = WindowCompat.getInsetsController(window, window.decorView)
                        if (enabled) {
                              if (previousOrientation == null) {
                                    previousOrientation = pluginActivity.requestedOrientation
                                    previousBarBehavior = controller.systemBarsBehavior
                                    val insets = androidx.core.view.ViewCompat.getRootWindowInsets(window.decorView)
                                    statusWasVisible = insets?.isVisible(WindowInsetsCompat.Type.statusBars()) ?: true
                                    navigationWasVisible = insets?.isVisible(WindowInsetsCompat.Type.navigationBars()) ?: true
                              }
                              pluginActivity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                              controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                              controller.hide(WindowInsetsCompat.Type.systemBars())
                        } else if (previousOrientation != null) {
                              pluginActivity.requestedOrientation = previousOrientation!!
                              previousOrientation = null
                              previousBarBehavior?.let { controller.systemBarsBehavior = it }
                              if (statusWasVisible) controller.show(WindowInsetsCompat.Type.statusBars())
                              if (navigationWasVisible) controller.show(WindowInsetsCompat.Type.navigationBars())
                        }
                        invoke.resolve()
                  } catch (error: Exception) {
                        invoke.reject("Unable to change chart orientation", error)
                  }
            }
      }

      private val credentialManager: CredentialManager =
            CredentialManager.create(pluginActivity)

      @Command
      fun createPasskeyCommand(invoke: Invoke) {
            createPasskey(invoke, pluginActivity, credentialManager)
      }

      @Command
      fun getCredentialCommand(invoke: Invoke) {
            getCredential(invoke, pluginActivity, credentialManager)
      }
}