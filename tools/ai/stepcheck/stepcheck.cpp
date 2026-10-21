/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Exact STEP solid-collision checker used by kicad-agent.
 *
 * Reads a STEP file, enumerates its solids, and computes pairwise boolean
 * intersections with OpenCASCADE.  Two solids collide when the common volume
 * exceeds a small threshold; touching faces (the normal case for a board and
 * its components) produce zero volume and are not reported.
 *
 * This is B-rep intersection rather than triangle-mesh intersection: it is
 * exact for the STEP geometry and avoids tessellation tolerance choices.
 */

#include <BRepAlgoAPI_Common.hxx>
#include <BRepBndLib.hxx>
#include <BRep_Builder.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPControl_Reader.hxx>
#include <TCollection_AsciiString.hxx>
#include <TDataStd_Name.hxx>
#include <TDF_ChildIterator.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Solid.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <sstream>
#include <string>
#include <vector>

namespace
{

struct Box
{
    double xmin = 0, ymin = 0, zmin = 0, xmax = 0, ymax = 0, zmax = 0;
    bool   valid = false;
};

struct Solid
{
    TopoDS_Solid shape;
    Box          box;
    std::string  name;
};

struct NamedShape
{
    TopoDS_Shape shape;
    std::string  name;
};

std::string labelName( const TDF_Label& aLabel )
{
    Handle( TDataStd_Name ) attribute;

    if( !aLabel.FindAttribute( TDataStd_Name::GetID(), attribute ) )
        return {};

    TCollection_AsciiString ascii( attribute->Get(), '?' );
    return ascii.ToCString();
}

std::string findName( const std::vector<NamedShape>& aNames, const TopoDS_Shape& aSolid )
{
    for( const NamedShape& named : aNames )
    {
        if( named.shape.IsSame( aSolid ) )
            return named.name;
    }

    for( const NamedShape& named : aNames )
    {
        TopTools_IndexedMapOfShape solids;
        TopExp::MapShapes( named.shape, TopAbs_SOLID, solids );

        for( int i = 1; i <= solids.Extent(); ++i )
        {
            if( solids( i ).IsSame( aSolid ) )
                return named.name;
        }
    }

    return {};
}

std::string jsonEscape( const std::string& value )
{
    std::string out;
    out.reserve( value.size() + 8 );

    for( char c : value )
    {
        switch( c )
        {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:
            if( static_cast<unsigned char>( c ) < 0x20 )
            {
                char buf[8];
                std::snprintf( buf, sizeof( buf ), "\\u%04x", c );
                out += buf;
            }
            else
            {
                out += c;
            }
        }
    }

    return out;
}

bool boxesOverlap( const Box& a, const Box& b, double epsilon )
{
    if( !a.valid || !b.valid )
        return false;

    return a.xmax >= b.xmin - epsilon && b.xmax >= a.xmin - epsilon
           && a.ymax >= b.ymin - epsilon && b.ymax >= a.ymin - epsilon
           && a.zmax >= b.zmin - epsilon && b.zmax >= a.zmin - epsilon;
}

void printBox( std::FILE* out, const Box& box )
{
    std::fprintf( out, "[%.6f,%.6f,%.6f,%.6f,%.6f,%.6f]",
                  box.xmin, box.ymin, box.zmin, box.xmax, box.ymax, box.zmax );
}

} // namespace


int main( int argc, char** argv )
{
    if( argc < 2 )
    {
        std::fprintf( stderr,
                      "usage: kicad-stepcheck <file.step> [--min-volume-mm3 V] [--max-pairs N]\n" );
        return 2;
    }

    const std::string stepPath = argv[1];
    const bool        selfTest = stepPath == "--self-test";
    double            minVolume = 1e-4; // mm^3
    long              maxPairs = 2000000;

    for( int i = 2; i < argc; ++i )
    {
        if( std::strcmp( argv[i], "--min-volume-mm3" ) == 0 && i + 1 < argc )
            minVolume = std::atof( argv[++i] );
        else if( std::strcmp( argv[i], "--max-pairs" ) == 0 && i + 1 < argc )
            maxPairs = std::atol( argv[++i] );
    }

    std::vector<Solid> solids;
    double             epsilon = 1e-6;

    if( selfTest )
    {
        // Two 10 mm cubes overlapping in a 5 mm cube (125 mm^3).
        TopoDS_Shape a = BRepPrimAPI_MakeBox( 10.0, 10.0, 10.0 ).Shape();
        TopoDS_Shape b = BRepPrimAPI_MakeBox( gp_Pnt( 5.0, 5.0, 5.0 ), 10.0, 10.0, 10.0 ).Shape();

        for( const TopoDS_Shape& shape : { a, b } )
        {
            Solid solid;
            solid.shape = TopoDS::Solid( shape );
            Bnd_Box box;
            BRepBndLib::Add( solid.shape, box, false );
            box.Get( solid.box.xmin, solid.box.ymin, solid.box.zmin,
                     solid.box.xmax, solid.box.ymax, solid.box.zmax );
            solid.box.valid = true;
            solid.name = solids.empty() ? "cube A" : "cube B";
            solids.push_back( solid );
        }
    }
    else
    {
        STEPCAFControl_Reader reader;
        IFSelect_ReturnStatus status = reader.ReadFile( stepPath.c_str() );

        if( status != IFSelect_RetDone )
        {
            std::fprintf( stderr, "failed to read STEP file %s (status %d)\n",
                          stepPath.c_str(), static_cast<int>( status ) );
            return 2;
        }

        Handle( XCAFApp_Application ) app = XCAFApp_Application::GetApplication();
        Handle( TDocStd_Document ) document;

        app->NewDocument( "MDTV-XCAF", document );

        if( document.IsNull() || !reader.Transfer( document ) )
        {
            std::fprintf( stderr, "failed to transfer STEP document\n" );
            return 2;
        }

        Handle( XCAFDoc_ShapeTool ) shapeTool =
                XCAFDoc_DocumentTool::ShapeTool( document->Main() );

        std::vector<NamedShape> names;

        std::function<void( const TDF_Label& )> walkLabels = [&]( const TDF_Label& label )
        {
            std::string name = labelName( label );

            if( !name.empty() )
            {
                TopoDS_Shape shape = shapeTool->GetShape( label );

                if( !shape.IsNull() )
                    names.push_back( { shape, name } );
            }

            for( TDF_ChildIterator child( label ); child.More(); child.Next() )
                walkLabels( child.Value() );
        };

        walkLabels( document->Main() );

        TDF_LabelSequence freeShapes;
        shapeTool->GetFreeShapes( freeShapes );

        TopoDS_Compound compound;
        BRep_Builder    builder;
        builder.MakeCompound( compound );

        for( Standard_Integer i = 1; i <= freeShapes.Length(); ++i )
        {
            TopoDS_Shape shape = shapeTool->GetShape( freeShapes.Value( i ) );

            if( !shape.IsNull() )
                builder.Add( compound, shape );
        }

        TopoDS_Shape root = compound;

        if( root.IsNull() )
        {
            std::fprintf( stderr, "STEP file contains no shape\n" );
            return 2;
        }

        TopTools_IndexedMapOfShape seen;

        for( TopExp_Explorer explorer( root, TopAbs_SOLID ); explorer.More(); explorer.Next() )
        {
            if( seen.Contains( explorer.Current() ) )
                continue;

            seen.Add( explorer.Current() );

            Solid solid;
            solid.shape = TopoDS::Solid( explorer.Current() );
            solid.name = findName( names, solid.shape );

            Bnd_Box box;
            BRepBndLib::Add( solid.shape, box, false );

            if( box.IsVoid() )
                continue;

            box.Get( solid.box.xmin, solid.box.ymin, solid.box.zmin,
                     solid.box.xmax, solid.box.ymax, solid.box.zmax );
            solid.box.valid = true;

            solids.push_back( solid );
        }
    }

    std::ostringstream collisions;
    int    collisionCount = 0;
    int    checkErrors = 0;
    long   checkedPairs = 0;
    bool   first = true;

    for( size_t i = 0; i < solids.size() && checkedPairs < maxPairs; ++i )
    {
        for( size_t j = i + 1; j < solids.size() && checkedPairs < maxPairs; ++j )
        {
            if( !boxesOverlap( solids[i].box, solids[j].box, epsilon ) )
                continue;

            checkedPairs++;

            BRepAlgoAPI_Common common( solids[i].shape, solids[j].shape );
            common.SetFuzzyValue( epsilon );
            common.Build();

            if( !common.IsDone() )
            {
                checkErrors++;
                continue;
            }

            GProp_GProps properties;

            try
            {
                BRepGProp::VolumeProperties( common.Shape(), properties );
            }
            catch( ... )
            {
                checkErrors++;
                continue;
            }

            const double volume = std::abs( properties.Mass() );

            if( volume <= minVolume )
                continue;

            if( !first )
                collisions << ",";

            first = false;
            collisionCount++;

            char header[512];
            std::snprintf( header, sizeof( header ),
                           "{\"a\":%zu,\"b\":%zu,\"aName\":\"%s\",\"bName\":\"%s\","
                           "\"volumeMm3\":%.9g,\"aBox\":",
                           i, j, jsonEscape( solids[i].name ).c_str(),
                           jsonEscape( solids[j].name ).c_str(), volume );
            collisions << header;

            std::FILE* buffer = std::tmpfile();

            if( buffer )
            {
                printBox( buffer, solids[i].box );
                std::fputs( ",\"bBox\":", buffer );
                printBox( buffer, solids[j].box );

                std::rewind( buffer );

                char chunk[1024];
                size_t read = 0;

                while( ( read = std::fread( chunk, 1, sizeof( chunk ), buffer ) ) > 0 )
                    collisions.write( chunk, static_cast<std::streamsize>( read ) );

                std::fclose( buffer );
            }

            collisions << "}";
        }
    }

    const bool truncated = checkedPairs >= maxPairs;

    std::printf( "{\"ok\":%s,\"step\":\"%s\",\"solids\":%zu,\"collisions\":[%s],"
                 "\"checkedPairs\":%ld,\"errors\":%d,\"truncated\":%s,"
                 "\"minVolumeMm3\":%.9g}\n",
                 collisionCount == 0 && checkErrors == 0 ? "true" : "false",
                 jsonEscape( stepPath ).c_str(), solids.size(),
                 collisions.str().c_str(), checkedPairs, checkErrors,
                 truncated ? "true" : "false", minVolume );

    std::fflush( stdout );

    if( checkErrors > 0 && collisionCount == 0 )
        return 1;

    return collisionCount > 0 ? 5 : 0;
}
