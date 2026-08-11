@echo off
REM 🛠️ Astrid Sophia - Build Script (Windows)
REM Compila el proyecto completo: frontend + backend Tauri

echo ========================================
echo 🚀 Astrid Sophia - Build Script v1.0
echo ========================================
echo.

REM Verificar dependencias
echo 📋 Verificando dependencias...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [✗] Node.js no está instalado. Por favor instálalo desde https://nodejs.org/
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [✓] Node.js: %NODE_VERSION%

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [✗] npm no está instalado.
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [✓] npm: %NPM_VERSION%

where rustc >nul 2>nul
if %errorlevel% neq 0 (
    echo [✗] Rust no está instalado. Por favor instálalo desde https://rustup.rs/
    exit /b 1
)
for /f "tokens=*" %%i in ('rustc --version') do set RUST_VERSION=%%i
echo [✓] Rust: %RUST_VERSION%

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [✗] Cargo no está instalado.
    exit /b 1
)
for /f "tokens=*" %%i in ('cargo --version') do set CARGO_VERSION=%%i
echo [✓] Cargo: %CARGO_VERSION%

echo.

REM Limpiar build anterior (opcional)
if "%1"=="--clean" (
    echo 🧹 Limpiando builds anteriores...
    if exist dist rmdir /s /q dist
    if exist src-tauri\target rmdir /s /q src-tauri\target
    echo [✓] Limpieza completada
    echo.
)

REM Instalar dependencias de frontend
echo 📦 Instalando dependencias de frontend...
call npm install --silent
echo [✓] Dependencias instaladas
echo.

REM Build del frontend con Vite
echo 🏗️  Compilando frontend (Vite)...
call npm run build
echo [✓] Frontend compilado en dist/
echo.

REM Verificar código Rust
echo 🔍 Verificando código Rust...
cd src-tauri
call cargo check --release
if %errorlevel% neq 0 (
    echo [✗] Error al verificar código Rust
    cd ..
    exit /b 1
)
cd ..
echo [✓] Código Rust verificado
echo.

REM Ejecutar tests de Rust (opcional)
if "%2"=="--no-test" (
    echo [!] Saltando tests de Rust
    echo.
) else (
    echo 🧪 Ejecutando tests de Rust...
    cd src-tauri
    call cargo test --release --quiet
    if %errorlevel% neq 0 (
        echo [✗] Tests de Rust fallaron
        cd ..
        exit /b 1
    )
    cd ..
    echo [✓] Tests de Rust aprobados
    echo.
)

REM Build de producción de Tauri
echo 📦 Empaquetando aplicación Tauri...
if "%1"=="--debug" (
    call npm run tauri build -- --debug
    echo [✓] Build debug completada en src-tauri\target\debug\bundle\
) else (
    call npm run tauri build
    echo [✓] Build release completada en src-tauri\target\release\bundle\
)

echo.
echo ========================================
echo ✅ Build completada exitosamente
echo ========================================
echo.
echo 📁 Archivos generados:
echo    - Frontend: dist/
echo    - Backend:  src-tauri\target\*\bundle/
echo.
echo 🚀 Para ejecutar en modo desarrollo:
echo    npm run dev
echo.
