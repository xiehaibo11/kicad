/*
 * This program source code file is part of KiCad, a free EDA CAD application.
 *
 * Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#pragma once

#include <api/api_handler_sch.h>

/**
 * AI automation extensions to the schematic API handler.
 *
 * These commands make library-driven schematic generation possible without
 * requiring the client to serialize a complete embedded LIB_SYMBOL.
 */
class API_HANDLER_SCH_AI : public API_HANDLER_SCH
{
public:
    explicit API_HANDLER_SCH_AI( SCH_EDIT_FRAME* aFrame );
    API_HANDLER_SCH_AI( std::shared_ptr<SCH_CONTEXT> aContext, SCH_EDIT_FRAME* aFrame = nullptr );

private:
    HANDLER_RESULT<kiapi::schematic::commands::SearchLibrarySymbolsResponse>
    handleSearchLibrarySymbols(
            const HANDLER_CONTEXT<kiapi::schematic::commands::SearchLibrarySymbolsRequest>& aCtx );

    HANDLER_RESULT<kiapi::schematic::commands::GetLibrarySymbolResponse>
    handleGetLibrarySymbol(
            const HANDLER_CONTEXT<kiapi::schematic::commands::GetLibrarySymbolRequest>& aCtx );

    HANDLER_RESULT<kiapi::schematic::commands::PlaceSymbolFromLibraryResponse>
    handlePlaceSymbolFromLibrary(
            const HANDLER_CONTEXT<kiapi::schematic::commands::PlaceSymbolFromLibraryRequest>& aCtx );

    HANDLER_RESULT<kiapi::schematic::commands::AnnotateSchematicResponse>
    handleAnnotateSchematic(
            const HANDLER_CONTEXT<kiapi::schematic::commands::AnnotateSchematicRequest>& aCtx );
};
