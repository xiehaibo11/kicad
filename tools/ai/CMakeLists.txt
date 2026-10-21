# kicad-agent: AI automation terminal
#
# Optional Go build, enabled with -DKICAD_BUILD_AI_AGENT=ON.
# The upstream easyeda-agent source is a git submodule; initialize it with:
#   git submodule update --init tools/ai/upstream/easyeda-agent

find_program( GO_EXECUTABLE go )

if( NOT GO_EXECUTABLE )
    message( FATAL_ERROR
        "KICAD_BUILD_AI_AGENT=ON requires Go, but go was not found in PATH" )
endif()

if( NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/upstream/easyeda-agent/go.mod" )
    message( FATAL_ERROR
        "The easyeda-agent submodule is missing. Run:\n"
        "  git submodule update --init tools/ai/upstream/easyeda-agent" )
endif()

set( AGENT_EXE "kicad-agent${CMAKE_EXECUTABLE_SUFFIX}" )
set( AGENT_OUT_DIR "${CMAKE_BINARY_DIR}/bin" )
set( AGENT_ENV "CGO_ENABLED=0" )
set( AGENT_TAGS "" )

if( KICAD_BUILD_AI_AGENT_IPC )
    if( NOT NNG_INCLUDE_DIR OR NOT NNG_LIBRARY )
        message( FATAL_ERROR
            "KICAD_BUILD_AI_AGENT_IPC requires NNG (NNG_INCLUDE_DIR/NNG_LIBRARY)" )
    endif()

    set( AGENT_TAGS -tags nng )
    set( AGENT_LDFLAGS "${NNG_LIBRARY}" )

    if( UNIX AND NOT APPLE )
        set( AGENT_LDFLAGS "${AGENT_LDFLAGS} -lpthread -lm" )
    endif()

    set( AGENT_ENV
        "CGO_ENABLED=1"
        "CGO_CFLAGS=-I${NNG_INCLUDE_DIR}"
        "CGO_LDFLAGS=${AGENT_LDFLAGS}" )
endif()

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
        RUNTIME_OUTPUT_DIRECTORY "${AGENT_OUT_DIR}" )

    install( TARGETS kicad-stepcheck
             DESTINATION "${AGENT_INSTALL_DIR}"
             COMPONENT binary )
else()
    message( STATUS "OpenCASCADE not found; exact STEP collision tool will not be built" )
endif()

file( GLOB_RECURSE AGENT_GO_SOURCES CONFIGURE_DEPENDS
      "${CMAKE_CURRENT_SOURCE_DIR}/kicad-agent/*.go"
      "${CMAKE_CURRENT_SOURCE_DIR}/kicad-agent/internal/kicadactions/native-tools.json"
      "${CMAKE_CURRENT_SOURCE_DIR}/kicad-agent/go.mod"
      "${CMAKE_CURRENT_SOURCE_DIR}/kicad-agent/go.sum" )

add_custom_command(
    OUTPUT "${AGENT_OUT_DIR}/${AGENT_EXE}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${AGENT_OUT_DIR}"
    COMMAND ${CMAKE_COMMAND} -E env ${AGENT_ENV}
            ${GO_EXECUTABLE} build ${AGENT_TAGS}
            -trimpath -buildvcs=false
            -o "${AGENT_OUT_DIR}/${AGENT_EXE}"
            ./cmd/kicad-agent
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/kicad-agent"
    DEPENDS ${AGENT_GO_SOURCES}
    COMMENT "Building kicad-agent AI automation terminal"
    VERBATIM )

add_custom_target( kicad-agent ALL DEPENDS "${AGENT_OUT_DIR}/${AGENT_EXE}" )

install( PROGRAMS "${AGENT_OUT_DIR}/${AGENT_EXE}"
         DESTINATION "${AGENT_INSTALL_DIR}"
         COMPONENT binary )
