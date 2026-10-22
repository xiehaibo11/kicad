# Shared JavaScript automation; native CLI/IPC without a Go process.
find_program( NODE_EXECUTABLE node REQUIRED )
find_program( BUN_EXECUTABLE bun HINTS "$ENV{HOME}/.bun/bin" REQUIRED )
set( DIRECT_OUT_DIR "${CMAKE_BINARY_DIR}/bin" )
if( APPLE )
    # Keep the installed agent inside KiCad.app, next to kicad-cli; the DMG
    # root is not signed or searched by FindKicadFile().
    set( AGENT_INSTALL_DIR "${OSX_BUNDLE_INSTALL_BIN_DIR}" )
else()
    set( AGENT_INSTALL_DIR "${KICAD_BIN}" )
endif()

if( OCC_FOUND )
    add_executable( kicad-stepcheck stepcheck/stepcheck.cpp )
    target_include_directories( kicad-stepcheck PRIVATE ${OCC_INCLUDE_DIR} )
    target_link_libraries( kicad-stepcheck PRIVATE ${OCC_LIBRARIES} )
    set_target_properties( kicad-stepcheck PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${DIRECT_OUT_DIR}" )

    install( TARGETS kicad-stepcheck
             DESTINATION "${AGENT_INSTALL_DIR}"
             COMPONENT binary )
else()
    message( STATUS "OpenCASCADE not found; exact STEP collision tool will not be built" )
endif()

file( GLOB_RECURSE DIRECT_SOURCES CONFIGURE_DEPENDS
      "${CMAKE_CURRENT_SOURCE_DIR}/direct/*.mjs"
      "${CMAKE_CURRENT_SOURCE_DIR}/direct/data/*.json"
      "${CMAKE_CURRENT_SOURCE_DIR}/direct/generated/*.json" )
list( FILTER DIRECT_SOURCES EXCLUDE REGEX "/(node_modules|dist|test)/" )
add_custom_command(
    OUTPUT "${DIRECT_OUT_DIR}/kicad-direct.mjs"
    COMMAND ${CMAKE_COMMAND} -E env "BUN=${BUN_EXECUTABLE}"
            ${NODE_EXECUTABLE} "${CMAKE_CURRENT_SOURCE_DIR}/direct/build.mjs"
            "${DIRECT_OUT_DIR}/kicad-direct.mjs"
    DEPENDS ${DIRECT_SOURCES}
    COMMENT "Bundling shared KiCad JavaScript runtime"
    VERBATIM )
add_custom_target( kicad-direct ALL DEPENDS "${DIRECT_OUT_DIR}/kicad-direct.mjs" )
install( PROGRAMS "${DIRECT_OUT_DIR}/kicad-direct.mjs"
         DESTINATION "${AGENT_INSTALL_DIR}" COMPONENT binary )
install( FILES "${DIRECT_OUT_DIR}/LICENSE-protobufjs.txt"
               "${DIRECT_OUT_DIR}/LICENSE-blocks-MIT.txt"
         DESTINATION "${AGENT_INSTALL_DIR}" COMPONENT binary )
