import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ключ подписи — в keystore\keystore.properties (в APK не попадает; ключ нужен для всех будущих обновлений)
val ks = Properties().apply {
    val f = rootProject.file("keystore/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "app.felixassistant.link"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.felixassistant.link"
        minSdk = 28          // Android 9 и новее
        targetSdk = 33
        versionCode = 3
        versionName = "1.2"
    }

    buildFeatures {
        buildConfig = true   // BuildConfig.VERSION_NAME — компьютер узнаёт, что умеет приложение
    }

    signingConfigs {
        create("release") {
            if (ks.getProperty("storeFile") != null) {
                storeFile = file(ks.getProperty("storeFile"))
                storePassword = ks.getProperty("storePassword")
                keyAlias = ks.getProperty("keyAlias")
                keyPassword = ks.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ks.getProperty("storeFile") != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
