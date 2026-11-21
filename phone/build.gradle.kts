// «Феликс Link» — пульт для ассистента «Феликс» на компьютере (Android 9+).
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}

// сборка — в phone\build\<модуль> (APK: phone\build\app\outputs\apk\release)
allprojects {
    layout.buildDirectory.set(rootProject.file("build/${project.name}"))
}
